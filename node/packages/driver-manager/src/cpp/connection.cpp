#include "connection.h"
#include "database.h"
#include "addon_data.h"

Napi::Object NodeAdbcConnection::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AdbcConnection", {
    });

    AddonData* data = env.GetInstanceData<AddonData>();
    data->connectionConstructor = Napi::Persistent(func);

    exports.Set("AdbcConnection", func);
    return exports;
}

NodeAdbcConnection::NodeAdbcConnection(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NodeAdbcConnection>(info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected AdbcDatabase object").ThrowAsJavaScriptException();
        return;
    }

    Napi::Object dbObj = info[0].As<Napi::Object>();
    NodeAdbcDatabase* db = Napi::ObjectWrap<NodeAdbcDatabase>::Unwrap(dbObj);
    
    driver_loader_ = db->GetDriver();
    database_ref_ = Napi::Persistent(dbObj); // Prevent GC of DB while Connection is alive

    memset(&connection_, 0, sizeof(connection_));
    AdbcError error = {};
    
    AdbcStatusCode status = driver_loader_->get()->ConnectionNew(&connection_, &error);
    if (status != ADBC_STATUS_OK) {
         if (error.release) error.release(&error);
         Napi::Error::New(env, "ConnectionNew failed").ThrowAsJavaScriptException();
         return;
    }

    status = driver_loader_->get()->ConnectionInit(&connection_, db->GetHandle(), &error);
    if (status != ADBC_STATUS_OK) {
        std::string msg = "ConnectionInit failed";
        if (error.message) msg += ": " + std::string(error.message);
        if (error.release) error.release(&error);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return;
    }
}

NodeAdbcConnection::~NodeAdbcConnection() {
    if (connection_.private_data) {
        AdbcError error = {};
        if (driver_loader_->get()->ConnectionRelease) {
            driver_loader_->get()->ConnectionRelease(&connection_, &error);
        }
        if (error.release) error.release(&error);
    }
    // database_ref_ will be destructed automatically, allowing DB to be GC'd if no other refs
}
