#pragma once

#include <string>
#include <memory>
#include <stdexcept>
#include <uv.h>
#include "adbc.h"

class DriverLoader {
public:
    DriverLoader(const std::string& path, const std::string& entrypoint) {
        int status = uv_dlopen(path.c_str(), &lib_);
        if (status != 0) {
            throw std::runtime_error("Failed to load library: " + path + " (" + uv_dlerror(&lib_) + ")");
        }

        void* func_ptr;
        status = uv_dlsym(&lib_, entrypoint.c_str(), &func_ptr);
        if (status != 0) {
            uv_dlclose(&lib_);
            throw std::runtime_error("Failed to find entrypoint: " + entrypoint + " (" + uv_dlerror(&lib_) + ")");
        }

        auto init_func = reinterpret_cast<AdbcDriverInitFunc>(func_ptr);
        
        // Initialize driver struct
        // We must clear it first as per ADBC spec (or just allocate new)
        driver_ = new AdbcDriver();
        memset(driver_, 0, sizeof(AdbcDriver));
        
        // We assume version 1.1.0 for now
        AdbcError error;
        memset(&error, 0, sizeof(error));
        
        AdbcStatusCode code = init_func(ADBC_VERSION_1_1_0, driver_, &error);
        if (code != ADBC_STATUS_OK) {
            std::string msg = "AdbcDriverInit failed";
            if (error.message) msg += ": " + std::string(error.message);
            if (error.release) error.release(&error);
            
            delete driver_;
            uv_dlclose(&lib_);
            throw std::runtime_error(msg);
        }
    }

    ~DriverLoader() {
        if (driver_) {
             // Technically we should release the driver if it has a release callback
             if (driver_->release) {
                 AdbcError error;
                 driver_->release(driver_, &error);
                 // ignore error in destructor
             }
             delete driver_;
        }
        uv_dlclose(&lib_);
    }

    AdbcDriver* get() const { return driver_; }

private:
    uv_lib_t lib_;
    AdbcDriver* driver_ = nullptr;
};
