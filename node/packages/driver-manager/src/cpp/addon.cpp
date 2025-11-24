#include <napi.h>
#include "common.h"
#include "database.h"
#include "connection.h"
#include "statement.h"
#include "addon_data.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    AddonData* data = new AddonData();
    env.SetInstanceData(data);

    NodeAdbcDatabase::Init(env, exports);
    NodeAdbcConnection::Init(env, exports);
    NodeAdbcStatement::Init(env, exports);
    return exports;
}

NODE_API_MODULE(arrow_node_native, Init)