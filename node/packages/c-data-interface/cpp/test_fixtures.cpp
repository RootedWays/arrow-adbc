#include "common.h"

// --- Schema Factories ---

Napi::Value CreateInt32Schema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(schema.get());
  if (ArrowSchemaSetType(schema.get(), NANOARROW_TYPE_INT32) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}

Napi::Value CreateStringSchema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(schema.get());
  if (ArrowSchemaSetType(schema.get(), NANOARROW_TYPE_STRING) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}

Napi::Value CreateInt64Schema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(schema.get());
  if (ArrowSchemaSetType(schema.get(), NANOARROW_TYPE_INT64) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}

Napi::Value CreateFloat64Schema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(schema.get());
  if (ArrowSchemaSetType(schema.get(), NANOARROW_TYPE_DOUBLE) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}

Napi::Value CreateStructSchema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema struct_schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(struct_schema.get());

  // Set as a Struct type with 2 children
  if (ArrowSchemaSetTypeStruct(struct_schema.get(), 2) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set struct type").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Child 0: Int32 "id"
  // ArrowSchemaSetTypeStruct allocated the children array, we just need to init them
  ArrowSchema* id_schema = struct_schema->children[0];
  if (ArrowSchemaSetType(id_schema, NANOARROW_TYPE_INT32) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set id type").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (ArrowSchemaSetName(id_schema, "id") != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set id name").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Child 1: String "name"
  ArrowSchema* name_schema = struct_schema->children[1];
  if (ArrowSchemaSetType(name_schema, NANOARROW_TYPE_STRING) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set name type").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (ArrowSchemaSetName(name_schema, "name") != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set name name").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)struct_schema.release());
}

Napi::Value CreateTimestampSchema(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate ArrowSchema").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowSchema schema(raw_schema);
  active_schema_count++;
  ArrowSchemaInit(schema.get());
  
  if (ArrowSchemaSetTypeDateTime(schema.get(), NANOARROW_TYPE_TIMESTAMP, NANOARROW_TIME_UNIT_MILLI, "UTC") != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::BigInt::New(env, (uint64_t)schema.release());
}


// --- Array Factories ---

Napi::Value CreateStructArray(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // 1. Allocate main struct array
  ArrowArray* raw_struct_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_struct_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray for struct").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray struct_array(raw_struct_array);
  active_array_count++;

  // Init as Struct
  if (ArrowArrayInitFromType(struct_array.get(), NANOARROW_TYPE_STRUCT) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init struct array").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Allocate 2 children
  if (ArrowArrayAllocateChildren(struct_array.get(), 2) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to allocate children for struct array")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  // 2. Create and append data to Child 0 (Int32 "id")
  ArrowArray* id_array = struct_array->children[0];
  if (ArrowArrayInitFromType(id_array, NANOARROW_TYPE_INT32) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init id array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(id_array) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending id").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (ArrowArrayAppendInt(id_array, 1) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(id_array, 2) != NANOARROW_OK) return env.Null();
  if (ArrowArrayFinishBuildingDefault(id_array, nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish id array").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 3. Create and append data to Child 1 (String "name")
  ArrowArray* name_array = struct_array->children[1];
  if (ArrowArrayInitFromType(name_array, NANOARROW_TYPE_STRING) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init name array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(name_array) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending name").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (ArrowArrayAppendString(name_array, ArrowCharView("test1")) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendString(name_array, ArrowCharView("test2")) != NANOARROW_OK) return env.Null();
  // Manual padding for string if needed, but FinishBuilding should handle it usually unless we are
  // being very low level. However, my previous code had manual padding. ArrowArrayAppendString
  // should be safe. Let's stick to standard APIs.
  if (ArrowArrayFinishBuildingDefault(name_array, nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish name array").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 4. Finish parent struct array
  // We need to set length explicitly for struct array if we don't use append?
  // ArrowArrayStartAppending for struct...
  // If we built children manually, we should probably just set length.
  // OR use ArrowArrayFinishElement(struct_array) for each row.

  // Let's try explicit length set for simplicity as we filled children fully.
  struct_array->length = 2;
  struct_array->null_count = 0;

  // Validate
  if (ArrowArrayFinishBuildingDefault(struct_array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish struct array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)struct_array.release());
}

// --- Array Factories ---

Napi::Value CreateInt32Array(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  active_array_count++;

  if (ArrowArrayInitFromType(array.get(), NANOARROW_TYPE_INT32) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(array.get()) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayAppendInt(array.get(), 1) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 2) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 3) != NANOARROW_OK) return env.Null();

  if (ArrowArrayFinishBuildingDefault(array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)array.release());
}

Napi::Value CreateStringArray(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  active_array_count++;

  if (ArrowArrayInitFromType(array.get(), NANOARROW_TYPE_STRING) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(array.get()) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayAppendString(array.get(), ArrowCharView("foo")) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendString(array.get(), ArrowCharView("bar")) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendString(array.get(), ArrowCharView("baz")) != NANOARROW_OK) return env.Null();

  if (ArrowArrayFinishBuildingDefault(array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)array.release());
}

Napi::Value CreateInt64Array(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  active_array_count++;

  if (ArrowArrayInitFromType(array.get(), NANOARROW_TYPE_INT64) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(array.get()) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayAppendInt(array.get(), 10000000000LL) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 20000000000LL) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 30000000000LL) != NANOARROW_OK) return env.Null();

  if (ArrowArrayFinishBuildingDefault(array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)array.release());
}

Napi::Value CreateFloat64Array(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  active_array_count++;

  if (ArrowArrayInitFromType(array.get(), NANOARROW_TYPE_DOUBLE) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(array.get()) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayAppendDouble(array.get(), 1.1) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendDouble(array.get(), 2.2) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendDouble(array.get(), 3.3) != NANOARROW_OK) return env.Null();

  if (ArrowArrayFinishBuildingDefault(array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)array.release());
}

Napi::Value CreateTimestampArray(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ArrowArray* raw_array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
  if (!raw_array) {
    Napi::Error::New(env, "Failed to allocate ArrowArray").ThrowAsJavaScriptException();
    return env.Null();
  }
  UniqueArrowArray array(raw_array);
  active_array_count++;

  if (ArrowArrayInitFromType(array.get(), NANOARROW_TYPE_TIMESTAMP) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init array").ThrowAsJavaScriptException();
    return env.Null();
  }

  if (ArrowArrayStartAppending(array.get()) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to start appending").ThrowAsJavaScriptException();
    return env.Null();
  }

  // Append values (Milliseconds since epoch)
  if (ArrowArrayAppendInt(array.get(), 1609459200000LL) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 1609459201000LL) != NANOARROW_OK) return env.Null();
  if (ArrowArrayAppendInt(array.get(), 1609459202000LL) != NANOARROW_OK) return env.Null();

  if (ArrowArrayFinishBuildingDefault(array.get(), nullptr) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to finish array").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::BigInt::New(env, (uint64_t)array.release());
}

// --- Stream Factories ---

Napi::Value CreateInt32ArrayStream(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // 1. Create Schema (Int32)
  ArrowSchema* raw_schema = static_cast<ArrowSchema*>(ArrowMalloc(sizeof(ArrowSchema)));
  if (!raw_schema) {
    Napi::Error::New(env, "Failed to allocate schema").ThrowAsJavaScriptException();
    return env.Null();
  }
  ArrowSchemaInit(raw_schema);
  if (ArrowSchemaSetType(raw_schema, NANOARROW_TYPE_INT32) != NANOARROW_OK) {
    ArrowSchemaRelease(raw_schema);
    ArrowFree(raw_schema);
    Napi::Error::New(env, "Failed to set schema type").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 2. Allocate Stream
  ArrowArrayStream* raw_stream =
      static_cast<ArrowArrayStream*>(ArrowMalloc(sizeof(ArrowArrayStream)));
  if (!raw_stream) {
    ArrowSchemaRelease(raw_schema);
    ArrowFree(raw_schema);
    Napi::Error::New(env, "Failed to allocate stream").ThrowAsJavaScriptException();
    return env.Null();
  }

  UniqueArrowArrayStream stream(raw_stream);
  active_stream_count++;

  // 3. Init Stream with 3 arrays
  // ArrowBasicArrayStreamInit takes ownership of schema
  if (ArrowBasicArrayStreamInit(stream.get(), raw_schema, 3) != NANOARROW_OK) {
    Napi::Error::New(env, "Failed to init stream").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 4. Create and Set Arrays
  for (int i = 0; i < 3; i++) {
    ArrowArray* array = static_cast<ArrowArray*>(ArrowMalloc(sizeof(ArrowArray)));
    ArrowArrayInitFromType(array, NANOARROW_TYPE_INT32);
    ArrowArrayStartAppending(array);
    ArrowArrayAppendInt(array, i + 1);  // [1], [2], [3] - just one element per batch for simplicity
    ArrowArrayFinishBuildingDefault(array, nullptr);

    ArrowBasicArrayStreamSetArray(stream.get(), i, array);
  }

  return Napi::BigInt::New(env, (uint64_t)stream.release());
}

// Export test fixtures
void InitTestFixtures(Napi::Env env, Napi::Object exports) {
  // Schema Factories
  exports.Set(Napi::String::New(env, "createInt32Schema"),
              Napi::Function::New(env, CreateInt32Schema));
  exports.Set(Napi::String::New(env, "createStringSchema"),
              Napi::Function::New(env, CreateStringSchema));
  exports.Set(Napi::String::New(env, "createInt64Schema"),
              Napi::Function::New(env, CreateInt64Schema));
  exports.Set(Napi::String::New(env, "createFloat64Schema"),
              Napi::Function::New(env, CreateFloat64Schema));
  exports.Set(Napi::String::New(env, "createStructSchema"),
              Napi::Function::New(env, CreateStructSchema));
  exports.Set(Napi::String::New(env, "createTimestampSchema"),
              Napi::Function::New(env, CreateTimestampSchema));

  // Array Factories
  exports.Set(Napi::String::New(env, "createInt32Array"),
              Napi::Function::New(env, CreateInt32Array));
  exports.Set(Napi::String::New(env, "createStringArray"),
              Napi::Function::New(env, CreateStringArray));
  exports.Set(Napi::String::New(env, "createInt64Array"),
              Napi::Function::New(env, CreateInt64Array));
  exports.Set(Napi::String::New(env, "createFloat64Array"),
              Napi::Function::New(env, CreateFloat64Array));
  exports.Set(Napi::String::New(env, "createStructArray"),
              Napi::Function::New(env, CreateStructArray));
  exports.Set(Napi::String::New(env, "createTimestampArray"),
              Napi::Function::New(env, CreateTimestampArray));

  // Stream Factories
  exports.Set(Napi::String::New(env, "createInt32ArrayStream"),
              Napi::Function::New(env, CreateInt32ArrayStream));
}