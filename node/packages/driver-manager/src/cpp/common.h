#pragma once

#include <napi.h>

// Helper macro to check N-API status
#define CHECK_NAPI(env, call) \
    do { \
        napi_status status = (call); \
        if (status != napi_ok) { \
            Napi::Error::New(env, "N-API call failed").ThrowAsJavaScriptException(); \
            return env.Null(); \
        } \
    } while (0)
