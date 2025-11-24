#pragma once

#include "common.h"
#include "connection.h"
#include "adbc.h"

class NodeAdbcStatement : public Napi::ObjectWrap<NodeAdbcStatement> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NodeAdbcStatement(const Napi::CallbackInfo& info);
    ~NodeAdbcStatement();

    Napi::Value SetSqlQuery(const Napi::CallbackInfo& info);
    Napi::Value ExecuteQuery(const Napi::CallbackInfo& info);

private:
    struct AdbcStatement statement_;
    std::shared_ptr<DriverLoader> driver_loader_;
    Napi::ObjectReference connection_ref_;
};
