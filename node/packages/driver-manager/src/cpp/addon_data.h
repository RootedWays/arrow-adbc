#pragma once

#include <napi.h>

struct AddonData {
    Napi::FunctionReference databaseConstructor;
    Napi::FunctionReference connectionConstructor;
    Napi::FunctionReference statementConstructor;
    Napi::FunctionReference streamConstructor;
};
