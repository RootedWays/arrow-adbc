#include "statement.h"
#include "connection.h"
#include "addon_data.h"
#include <iostream>
#include <cstring> // For memset

// Helper class to wrap ArrowArrayStream for JS
class AdbcStatementStream : public Napi::ObjectWrap<AdbcStatementStream> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "AdbcStatementStream", {
            InstanceMethod("readNext", &AdbcStatementStream::ReadNext),
            InstanceMethod("getPointer", &AdbcStatementStream::GetPointer),
            InstanceMethod("release", &AdbcStatementStream::Release),
        });

        AddonData* data = env.GetInstanceData<AddonData>();
        data->streamConstructor = Napi::Persistent(func);
        
        return func;
    }

    static Napi::Object NewInstance(Napi::Env env, struct ArrowArrayStream* stream) {
        AddonData* data = env.GetInstanceData<AddonData>();
        Napi::Object obj = data->streamConstructor.New({});
        AdbcStatementStream* unwrapped = Napi::ObjectWrap<AdbcStatementStream>::Unwrap(obj);
        unwrapped->stream_ = stream;
        return obj;
    }

    AdbcStatementStream(const Napi::CallbackInfo& info) : Napi::ObjectWrap<AdbcStatementStream>(info) {
        stream_ = nullptr;
    }

    ~AdbcStatementStream() {
        ReleaseInternal();
    }

    void ReleaseInternal() {
        if (stream_) {
            if (stream_->release) {
                stream_->release(stream_);
            }
            delete stream_;
            stream_ = nullptr;
        }
    }

    Napi::Value Release(const Napi::CallbackInfo& info) {
        ReleaseInternal();
        return info.Env().Undefined();
    }

    Napi::Value GetPointer(const Napi::CallbackInfo& info) {
         if (!stream_) return info.Env().Null();
         return Napi::BigInt::New(info.Env(), reinterpret_cast<uint64_t>(stream_));
    }

    Napi::Value ReadNext(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!stream_ || !stream_->get_next) {
            Napi::Error::New(env, "Stream is closed or invalid").ThrowAsJavaScriptException();
            return env.Null();
        }

        // Allocate ArrowArray on heap to pass to JS
        struct ArrowArray* array = new struct ArrowArray;
        memset(array, 0, sizeof(struct ArrowArray));

        int status = stream_->get_next(stream_, array);
        if (status != 0) {
            const char* err = stream_->get_last_error(stream_);
            std::string msg = "Stream get_next failed";
            if (err) msg += ": " + std::string(err);
            delete array;
            Napi::Error::New(env, msg).ThrowAsJavaScriptException();
            return env.Null();
        }

        // Check if stream ended
        if (array->release == nullptr) {
            delete array;
            return env.Null();
        }

        // Return pointer as BigInt
        return Napi::BigInt::New(env, reinterpret_cast<uint64_t>(array));
    }

private:
    struct ArrowArrayStream* stream_;
};


Napi::Object NodeAdbcStatement::Init(Napi::Env env, Napi::Object exports) {
    // Init the Stream class locally (not exported directly to module, but used internally)
    AdbcStatementStream::Init(env, exports);

    Napi::Function func = DefineClass(env, "AdbcStatement", {
        InstanceMethod("setSqlQuery", &NodeAdbcStatement::SetSqlQuery),
        InstanceMethod("executeQuery", &NodeAdbcStatement::ExecuteQuery),
    });

    AddonData* data = env.GetInstanceData<AddonData>();
    data->statementConstructor = Napi::Persistent(func);

    exports.Set("AdbcStatement", func);
    return exports;
}

NodeAdbcStatement::NodeAdbcStatement(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NodeAdbcStatement>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected AdbcConnection object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object connObj = info[0].As<Napi::Object>();
    NodeAdbcConnection* conn = Napi::ObjectWrap<NodeAdbcConnection>::Unwrap(connObj);
    
    driver_loader_ = conn->GetDriver();
    connection_ref_ = Napi::Persistent(connObj);

    memset(&statement_, 0, sizeof(statement_));
    AdbcError error = {};
    
    AdbcStatusCode status = driver_loader_->get()->StatementNew(conn->GetHandle(), &statement_, &error);
    if (status != ADBC_STATUS_OK) {
         if (error.release) error.release(&error);
         Napi::Error::New(env, "StatementNew failed").ThrowAsJavaScriptException();
         return;
    }
}

NodeAdbcStatement::~NodeAdbcStatement() {
    if (statement_.private_data) {
        AdbcError error = {};
        if (driver_loader_->get()->StatementRelease) {
            driver_loader_->get()->StatementRelease(&statement_, &error);
        }
        if (error.release) error.release(&error);
    }
}

Napi::Value NodeAdbcStatement::SetSqlQuery(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected query string").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string query = info[0].As<Napi::String>().Utf8Value();
    AdbcError error = {};
    AdbcStatusCode status = driver_loader_->get()->StatementSetSqlQuery(&statement_, query.c_str(), &error);
    
    if (status != ADBC_STATUS_OK) {
        std::string msg = "SetSqlQuery failed";
        if (error.message) msg += ": " + std::string(error.message);
        if (error.release) error.release(&error);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    }

    return env.Undefined();
}

Napi::Value NodeAdbcStatement::ExecuteQuery(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    struct ArrowArrayStream* stream = new struct ArrowArrayStream;
    memset(stream, 0, sizeof(struct ArrowArrayStream));
    int64_t rows_affected = 0;
    AdbcError error = {};

    AdbcStatusCode status = driver_loader_->get()->StatementExecuteQuery(&statement_, stream, &rows_affected, &error);
    
    if (status != ADBC_STATUS_OK) {
        delete stream;
        std::string msg = "ExecuteQuery failed";
        if (error.message) msg += ": " + std::string(error.message);
        if (error.release) error.release(&error);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Null();
    }

    // Get Schema immediately
    struct ArrowSchema* schema = new struct ArrowSchema;
    memset(schema, 0, sizeof(struct ArrowSchema));
    int schemaStatus = stream->get_schema(stream, schema);
    if (schemaStatus != 0) {
         const char* err = stream->get_last_error(stream);
         std::string msg = "Failed to get schema from stream";
         if (err) msg += ": " + std::string(err);
         
         if (stream->release) stream->release(stream);
         delete stream;
         delete schema;
         
         Napi::Error::New(env, msg).ThrowAsJavaScriptException();
         return env.Null();
    }

    // Return object { schema: BigInt, stream: AdbcStatementStream }
    Napi::Object result = Napi::Object::New(env);
    result.Set("schema", Napi::BigInt::New(env, reinterpret_cast<uint64_t>(schema)));
    result.Set("stream", AdbcStatementStream::NewInstance(env, stream));
    result.Set("rowsAffected", Napi::BigInt::New(env, rows_affected));

    return result;
}
