#pragma once

#include <nanoarrow/nanoarrow.h>
#include <napi.h>

#include <atomic>
#include <memory>

// Global counters (for testing memory leaks)
// Defined in addon.cpp
extern std::atomic<int64_t> active_schema_count;
extern std::atomic<int64_t> active_array_count;
extern std::atomic<int64_t> active_stream_count;

// --- ArrowSchema Helpers ---

struct ArrowSchemaDeleter {
  void operator()(ArrowSchema* schema) {
    if (schema) {
      if (schema->release) {
        ArrowSchemaRelease(schema);
      }
      ArrowFree(schema);
      active_schema_count--;
    }
  }
};
using UniqueArrowSchema = std::unique_ptr<ArrowSchema, ArrowSchemaDeleter>;

// --- ArrowArray Helpers ---

struct ArrowArrayDeleter {
  void operator()(ArrowArray* array) {
    if (array) {
      if (array->release) {
        ArrowArrayRelease(array);
      }
      ArrowFree(array);
      active_array_count--;
    }
  }
};
using UniqueArrowArray = std::unique_ptr<ArrowArray, ArrowArrayDeleter>;

// --- ArrowArrayStream Helpers ---

struct ArrowArrayStreamDeleter {
  void operator()(ArrowArrayStream* stream) {
    if (stream) {
      if (stream->release) {
        ArrowArrayStreamRelease(stream);
      }
      ArrowFree(stream);
      active_stream_count--;
    }
  }
};
using UniqueArrowArrayStream = std::unique_ptr<ArrowArrayStream, ArrowArrayStreamDeleter>;

// Declaration for test fixture initialization
#ifdef TEST_FIXTURES_ENABLED
void InitTestFixtures(Napi::Env env, Napi::Object exports);
#endif
