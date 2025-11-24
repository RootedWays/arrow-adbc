cmake_minimum_required(VERSION 3.15)
project(arrow_node_native)

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

set(SOURCE_FILES
    "src/cpp/addon.cpp"
    "src/cpp/database.cpp"
    "src/cpp/connection.cpp"
    "src/cpp/statement.cpp"
    "src/cpp/common.h"
    "src/cpp/adbc.h"
    "src/cpp/driver_loader.h"
    "src/cpp/arrow_c_definitions.h"
)

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})

set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# macOS specific settings
if(APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES LINK_FLAGS "-undefined dynamic_lookup")
endif()

