#pragma once

#include "common.h"
#include "driver_loader.h"
#include "adbc.h"
#include <memory>

class NodeAdbcDatabase : public Napi::ObjectWrap<NodeAdbcDatabase> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NodeAdbcDatabase(const Napi::CallbackInfo& info);
    ~NodeAdbcDatabase();

    std::shared_ptr<DriverLoader> GetDriver() { return driver_loader_; }
    struct AdbcDatabase* GetHandle() { return &database_; }

private:
    struct AdbcDatabase database_;
    std::shared_ptr<DriverLoader> driver_loader_;
};
