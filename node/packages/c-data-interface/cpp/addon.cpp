#include "common.h"

// Global counters (for testing memory leaks)
std::atomic<int64_t> active_schema_count{0};
std::atomic<int64_t> active_array_count{0};
std::atomic<int64_t> active_stream_count{0};

// --- Schema Functions ---

Napi::Value GetSchemaFormat(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer argument").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  if (schema == nullptr || schema->release == nullptr) {
    return Napi::String::New(env, "Invalid or Released Schema");
  }
  return Napi::String::New(env, schema->format);
}

Napi::Value ReleaseSchema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer argument").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* raw_schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  if (raw_schema) {
    UniqueArrowSchema schema(raw_schema);
  }
  return env.Null();
}

Napi::Number GetActiveSchemaCount(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), (double)active_schema_count.load());
}

Napi::Value GetSchemaChild(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsBigInt() || !info[1].IsNumber()) {
    Napi::Error::New(env, "Expected (schemaPtr: BigInt, index: Number)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  int64_t index = info[1].As<Napi::Number>().Int64Value();

  if (!schema || !schema->children || index < 0 || index >= schema->n_children) {
    // Return null if invalid or out of bounds (could also throw)
    return env.Null();
  }

  // Return the raw pointer to the child.
  // IMPORTANT: The child is owned by the parent. The JS wrapper must NOT release it.
  return Napi::BigInt::New(env, (uint64_t)schema->children[index]);
}

Napi::Value GetSchemaChildrenCount(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema) return Napi::Number::New(env, 0);
  return Napi::Number::New(env, static_cast<double>(schema->n_children));
}

Napi::Value GetSchemaName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema || !schema->name) return env.Null();
  return Napi::String::New(env, schema->name);
}

Napi::Value GetSchemaFlags(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema) return Napi::BigInt::New(env, (int64_t)0);
  return Napi::BigInt::New(env, schema->flags);
}

Napi::Value GetSchemaInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema) {
    Napi::Error::New(env, "Invalid schema pointer").ThrowAsJavaScriptException();
    return env.Null();
  }

  struct ArrowSchemaView view;
  struct ArrowError error;
  if (ArrowSchemaViewInit(&view, schema, &error) != NANOARROW_OK) {
    Napi::Error::New(env, error.message).ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("typeId", Napi::Number::New(env, view.type));
  result.Set("storageTypeId", Napi::Number::New(env, view.storage_type));
  
  if (view.fixed_size != 0) {
      result.Set("fixedSize", Napi::Number::New(env, view.fixed_size));
  }
  if (view.decimal_bitwidth != 0) {
      result.Set("decimalBitwidth", Napi::Number::New(env, view.decimal_bitwidth));
      result.Set("decimalScale", Napi::Number::New(env, view.decimal_scale));
      result.Set("decimalPrecision", Napi::Number::New(env, view.decimal_precision));
  }
  if (view.time_unit != 0) { // NANOARROW_TIME_UNIT_NONE is 0
      result.Set("timeUnit", Napi::Number::New(env, view.time_unit));
  }
  if (view.timezone != nullptr) {
      result.Set("timezone", Napi::String::New(env, view.timezone));
  }
  if (view.extension_name.size_bytes > 0) {
      result.Set("extensionName", Napi::String::New(env, view.extension_name.data, view.extension_name.size_bytes));
  }
  if (view.extension_metadata.size_bytes > 0) {
      result.Set("extensionMetadata", Napi::String::New(env, view.extension_metadata.data, view.extension_metadata.size_bytes));
  }
  if (view.union_type_ids != nullptr) {
      result.Set("unionTypeIds", Napi::String::New(env, view.union_type_ids));
  }

  return result;
}

// --- Array Functions ---

Napi::Value GetArrayChild(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsBigInt() || !info[1].IsNumber()) {
    Napi::Error::New(env, "Expected (arrayPtr: BigInt, index: Number)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool lossless;
  ArrowArray* array =
      reinterpret_cast<ArrowArray*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  int64_t index = info[1].As<Napi::Number>().Int64Value();

  if (!array || !array->children || index < 0 || index >= array->n_children) {
    return env.Null();
  }

  // Return raw pointer to child. Owned by parent.
  return Napi::BigInt::New(env, (uint64_t)array->children[index]);
}

Napi::Value GetArrayBuffer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() != 3 || !info[0].IsBigInt() || !info[1].IsBigInt() || !info[2].IsNumber()) {
    Napi::Error::New(env,
                     "Expected arguments: (schemaPtr: BigInt, arrayPtr: BigInt, index: Number)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  ArrowArray* array =
      reinterpret_cast<ArrowArray*>(info[1].As<Napi::BigInt>().Uint64Value(&lossless));
  int32_t index = info[2].As<Napi::Number>().Int32Value();

  if (!schema || !array) {
    Napi::Error::New(env, "Invalid schema or array pointer").ThrowAsJavaScriptException();
    return env.Null();
  }

  ArrowArrayView view;
  ArrowArrayViewInitFromSchema(&view, schema, nullptr);

  if (ArrowArrayViewSetArray(&view, array, nullptr) != NANOARROW_OK) {
    ArrowArrayViewReset(&view);
    Napi::Error::New(env, "Failed to set array on view (mismatched schema/array?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Safety check for index
  if (index < 0 || index >= ArrowArrayViewGetNumBuffers(
                                &view)) {  // Check against actual number of buffers from view
    ArrowArrayViewReset(&view);
    Napi::Error::New(env, "Buffer index out of bounds").ThrowAsJavaScriptException();
    return env.Null();
  }

  ArrowBufferView buffer_view = view.buffer_views[index];

  // Napi::ArrayBuffer requires a non-null pointer.
  // If the buffer is null (e.g. no validity buffer), return Napi::Env.Null().
  // If data.data is not null but size is 0, return an empty ArrayBuffer.
  if (buffer_view.data.data == nullptr) {
    ArrowArrayViewReset(&view);
    return env.Null();  // Return JS null
  }
  if (buffer_view.size_bytes == 0) {
    ArrowArrayViewReset(&view);
    return Napi::ArrayBuffer::New(env, 0);  // Return an empty ArrayBuffer
  }

  // Create Zero-Copy ArrayBuffer
  // NOTE: We do NOT pass a finalizer here because the lifecycle is managed by the JS wrapper object
  // (SafeArrowArray) holding the ArrowArray.
  Napi::ArrayBuffer result =
      Napi::ArrayBuffer::New(env, const_cast<void*>(buffer_view.data.data), buffer_view.size_bytes);

  ArrowArrayViewReset(&view);
  return result;
}

Napi::Value GetArrayLength(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsBigInt() || !info[1].IsBigInt()) {
    Napi::Error::New(env, "Expected (schemaPtr: BigInt, arrayPtr: BigInt)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  ArrowArray* array =
      reinterpret_cast<ArrowArray*>(info[1].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema || !array) {
    Napi::Error::New(env, "Invalid schema or array pointer").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Using ArrowArrayView for consistency and validation
  ArrowArrayView view;
  ArrowArrayViewInitFromSchema(&view, schema, nullptr);
  if (ArrowArrayViewSetArray(&view, array, nullptr) != NANOARROW_OK) {
    ArrowArrayViewReset(&view);
    Napi::Error::New(env, "Failed to set array on view (mismatched schema/array?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  int64_t length = view.length;
  ArrowArrayViewReset(&view);
  return Napi::Number::New(env, static_cast<double>(length));
}

Napi::Value GetArrayNullCount(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsBigInt() || !info[1].IsBigInt()) {
    Napi::Error::New(env, "Expected (schemaPtr: BigInt, arrayPtr: BigInt)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  bool lossless;
  ArrowSchema* schema =
      reinterpret_cast<ArrowSchema*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));
  ArrowArray* array =
      reinterpret_cast<ArrowArray*>(info[1].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!schema || !array) {
    Napi::Error::New(env, "Invalid schema or array pointer").ThrowAsJavaScriptException();
    return env.Null();
  }

  ArrowArrayView view;
  ArrowArrayViewInitFromSchema(&view, schema, nullptr);
  if (ArrowArrayViewSetArray(&view, array, nullptr) != NANOARROW_OK) {
    ArrowArrayViewReset(&view);
    Napi::Error::New(env, "Failed to set array on view").ThrowAsJavaScriptException();
    return env.Null();
  }

  int64_t null_count = ArrowArrayViewComputeNullCount(&view);

  ArrowArrayViewReset(&view);
  return Napi::Number::New(env, static_cast<double>(null_count));
}

Napi::Value ReleaseArray(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowArray* raw_array =
      reinterpret_cast<ArrowArray*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (raw_array) {
    // Transfer to unique_ptr -> Deleter runs -> active_array_count--
    UniqueArrowArray array(raw_array);
  }
  return env.Null();
}

Napi::Number GetActiveArrayCount(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), (double)active_array_count.load());
}

// --- Stream Functions ---

Napi::Value ReleaseStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowArrayStream* raw_stream =
      reinterpret_cast<ArrowArrayStream*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (raw_stream) {
    UniqueArrowArrayStream stream(raw_stream);
  }
  return env.Null();
}

Napi::Number GetActiveStreamCount(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), (double)active_stream_count.load());
}

Napi::Value GetStreamSchema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowArrayStream* stream =
      reinterpret_cast<ArrowArrayStream*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!stream || !stream->get_schema) {
    Napi::Error::New(env, "Invalid stream").ThrowAsJavaScriptException();
    return env.Null();
  }

  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }

  UniqueArrowSchema schema(raw_schema);
  // IMPORTANT: Active count increment happens here because we allocated a new schema
  active_schema_count++;

  if (stream->get_schema(stream, schema.get()) != 0) {
    // On error, we still have the schema allocated, unique_ptr will free it.
    // We should probably try to get the error message from the stream if possible,
    // but ArrowArrayStreamGetLastError returns const char*.
    const char* err = stream->get_last_error(stream);
    Napi::Error::New(env, err ? err : "Failed to get schema from stream")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Ownership transferred to JS
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}

Napi::Value GetStreamNext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBigInt()) {
    Napi::Error::New(env, "Expected BigInt pointer").ThrowAsJavaScriptException();
    return env.Null();
  }
  bool lossless;
  ArrowArrayStream* stream =
      reinterpret_cast<ArrowArrayStream*>(info[0].As<Napi::BigInt>().Uint64Value(&lossless));

  if (!stream || !stream->get_next) {
    Napi::Error::New(env, "Invalid stream").ThrowAsJavaScriptException();
    return env.Null();
  }

  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  // Increment active array count
  active_array_count++;

  if (stream->get_next(stream, array.get()) != 0) {
    const char* err = stream->get_last_error(stream);
    Napi::Error::New(env, err ? err : "Failed to get next array from stream")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // Check if end of stream (released array)
  if (array->release == nullptr) {
    // The array is valid but released (empty/finished).
    // We should let UniqueArrowArray free the shell.
    // Return null to JS to indicate EOS.
    return env.Null();
  }

  // Return the populated array
  return Napi::BigInt::New(env, (uint64_t)array.release());
}

Napi::Value AllocateStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowArrayStream* stream = static_cast<ArrowArrayStream*>(ArrowMalloc(sizeof(ArrowArrayStream)));
  if (!stream) {
    Napi::Error::New(env, "Failed to allocate ArrowArrayStream").ThrowAsJavaScriptException();
    return env.Null();
  }
  // Zero-initialize to ensure safety (release callback is NULL)
  memset(stream, 0, sizeof(ArrowArrayStream));

  // We consider this an active stream even if empty, because the JS side will wrap it in
  // SafeArrowArrayStream which will eventually call release (checking for NULL release callback).
  // However, SafeArrowArrayStream wrapper expects to own it.
  active_stream_count++;

  return Napi::BigInt::New(env, (uint64_t)stream);
}

// Init
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Schema
  exports.Set(Napi::String::New(env, "getSchemaFormat"), Napi::Function::New(env, GetSchemaFormat));
  exports.Set(Napi::String::New(env, "releaseSchema"), Napi::Function::New(env, ReleaseSchema));
  exports.Set(Napi::String::New(env, "getActiveSchemaCount"),
              Napi::Function::New(env, GetActiveSchemaCount));
  exports.Set(Napi::String::New(env, "getSchemaChild"), Napi::Function::New(env, GetSchemaChild));
  exports.Set(Napi::String::New(env, "getSchemaChildrenCount"),
              Napi::Function::New(env, GetSchemaChildrenCount));
  exports.Set(Napi::String::New(env, "getSchemaName"), Napi::Function::New(env, GetSchemaName));
  exports.Set(Napi::String::New(env, "getSchemaFlags"), Napi::Function::New(env, GetSchemaFlags));
  exports.Set(Napi::String::New(env, "getSchemaInfo"), Napi::Function::New(env, GetSchemaInfo));

  // Array
  exports.Set(Napi::String::New(env, "getArrayBuffer"), Napi::Function::New(env, GetArrayBuffer));
  exports.Set(Napi::String::New(env, "getArrayLength"), Napi::Function::New(env, GetArrayLength));
  exports.Set(Napi::String::New(env, "getArrayNullCount"),
              Napi::Function::New(env, GetArrayNullCount));
  exports.Set(Napi::String::New(env, "getArrayChild"), Napi::Function::New(env, GetArrayChild));
  exports.Set(Napi::String::New(env, "releaseArray"), Napi::Function::New(env, ReleaseArray));
  exports.Set(Napi::String::New(env, "getActiveArrayCount"),
              Napi::Function::New(env, GetActiveArrayCount));

  // Stream
  exports.Set(Napi::String::New(env, "allocateStream"), Napi::Function::New(env, AllocateStream));
  exports.Set(Napi::String::New(env, "releaseStream"), Napi::Function::New(env, ReleaseStream));
  exports.Set(Napi::String::New(env, "getActiveStreamCount"),
              Napi::Function::New(env, GetActiveStreamCount));
  exports.Set(Napi::String::New(env, "getStreamSchema"), Napi::Function::New(env, GetStreamSchema));
  exports.Set(Napi::String::New(env, "getStreamNext"), Napi::Function::New(env, GetStreamNext));

  // Register Test Fixtures
#ifdef TEST_FIXTURES_ENABLED
  InitTestFixtures(env, exports);
#endif

  return exports;
}

NODE_API_MODULE(node_arrow_c_data, Init)