cmake_minimum_required(VERSION 3.15)
project(node_arrow_c_data)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)

# Get node-addon-api include directory
execute_process(COMMAND node -p "require('node-addon-api').include"
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        OUTPUT_VARIABLE NODE_ADDON_API_DIR
        OUTPUT_STRIP_TRAILING_WHITESPACE)

string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

include_directories(${CMAKE_JS_INC})
include_directories(${NODE_ADDON_API_DIR})

# Nanoarrow Configuration
set(NANOARROW_VERSION_MAJOR 0)
set(NANOARROW_VERSION_MINOR 7)
set(NANOARROW_VERSION_PATCH 0)
set(NANOARROW_VERSION "0.7.0")
set(NANOARROW_NAMESPACE_DEFINE "#define NANOARROW_NAMESPACE Arrow")

configure_file(vendor/nanoarrow/nanoarrow_config.h.in ${CMAKE_SOURCE_DIR}/vendor/nanoarrow/nanoarrow_config.h)

include_directories(vendor) # Allows #include <nanoarrow/nanoarrow.h>

file(GLOB NANOARROW_SOURCES "vendor/nanoarrow/common/*.c")

set(SOURCE_FILES
    "cpp/addon.cpp"
    "cpp/common.h"
)

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    list(APPEND SOURCE_FILES "cpp/test_fixtures.cpp")
    add_definitions(-DTEST_FIXTURES_ENABLED)
endif()

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${NANOARROW_SOURCES} ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# macOS specific settings
if(APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "-undefined dynamic_lookup")
endif()
