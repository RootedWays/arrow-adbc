#pragma once

#include "common.h"
#include "database.h"
#include "adbc.h"

class NodeAdbcConnection : public Napi::ObjectWrap<NodeAdbcConnection> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NodeAdbcConnection(const Napi::CallbackInfo& info);
    ~NodeAdbcConnection();
    
    std::shared_ptr<DriverLoader> GetDriver() { return driver_loader_; }
    struct AdbcConnection* GetHandle() { return &connection_; }

private:
    struct AdbcConnection connection_;
    std::shared_ptr<DriverLoader> driver_loader_;
    Napi::ObjectReference database_ref_; // Keep database alive
};
