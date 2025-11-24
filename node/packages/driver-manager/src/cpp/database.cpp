#include "database.h"
#include "addon_data.h"
#include <iostream>

Napi::Object NodeAdbcDatabase::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AdbcDatabase", {
    });

    AddonData* data = env.GetInstanceData<AddonData>();
    data->databaseConstructor = Napi::Persistent(func);

    exports.Set("AdbcDatabase", func);
    return exports;
}

NodeAdbcDatabase::NodeAdbcDatabase(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NodeAdbcDatabase>(info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected driver path (string)").ThrowAsJavaScriptException();
        return;
    }
    
    std::string path = info[0].As<Napi::String>().Utf8Value();
    std::string entrypoint = "AdbcDriverInit";
    if (info.Length() > 1 && info[1].IsString()) {
        entrypoint = info[1].As<Napi::String>().Utf8Value();
    }

    try {
        driver_loader_ = std::make_shared<DriverLoader>(path, entrypoint);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return;
    }

    // Initialize Database
    memset(&database_, 0, sizeof(database_));
    AdbcError error = {};
    AdbcStatusCode status = driver_loader_->get()->DatabaseNew(&database_, &error);
    if (status != ADBC_STATUS_OK) {
        std::string msg = "DatabaseNew failed";
        if (error.message) msg += ": " + std::string(error.message);
        if (error.release) error.release(&error);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return;
    }

    // Handle options
    if (info.Length() > 2 && info[2].IsObject()) {
        Napi::Object options = info[2].As<Napi::Object>();
        Napi::Array keys = options.GetPropertyNames();
        for (uint32_t i = 0; i < keys.Length(); i++) {
            Napi::Value key = keys[i];
            Napi::Value value = options.Get(key);
            
            std::string k = key.ToString().Utf8Value();
            std::string v = value.ToString().Utf8Value();

            status = driver_loader_->get()->DatabaseSetOption(&database_, k.c_str(), v.c_str(), &error);
            if (status != ADBC_STATUS_OK) {
                 if (error.release) error.release(&error);
                 // Warn or throw? Usually throw.
                 Napi::Error::New(env, "Failed to set option " + k).ThrowAsJavaScriptException();
                 return;
            }
        }
    }

    status = driver_loader_->get()->DatabaseInit(&database_, &error);
    if (status != ADBC_STATUS_OK) {
        std::string msg = "DatabaseInit failed";
        if (error.message) msg += ": " + std::string(error.message);
        if (error.release) error.release(&error);
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return;
    }
}

NodeAdbcDatabase::~NodeAdbcDatabase() {
    // Release database
    if (database_.private_data) {
        AdbcError error = {};
        if (driver_loader_ && driver_loader_->get()->DatabaseRelease) {
            driver_loader_->get()->DatabaseRelease(&database_, &error);
        }
        if (error.release) error.release(&error);
    }
}
