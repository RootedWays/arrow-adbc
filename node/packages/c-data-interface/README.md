# Node Arrow C Data Interface (`node-arrow-c-data`)

Crude, minimum example of a Node.js C++ addon for the [Apache Arrow C Data Interface](https://arrow.apache.org/docs/format/CDataInterface.html). Built as an exploratory spike to get a single RecordBatch flowing through an ADBC driver into Arrow JS (zero-copy).

## What it does (experimental)

- Imports `ArrowSchema`/`ArrowArray`/`ArrowArrayStream` pointers into `apache-arrow` JS objects (RecordBatch, Vector, Schema).
- Zero-copy views over native buffers.
- Basic FinalizationRegistry-based cleanup of native handles.

## Build & test

```bash
npm install
npm run build:debug   # native addon + fixtures
npm test
```

Requires a C++ toolchain (N-API/node-addon-api).

## Usage

### 1. Importing a RecordBatch (Table Chunk)

If you have pointers to an `ArrowSchema` and an `ArrowArray` (representing a Struct/Table), you can import them as an Apache Arrow JS `RecordBatch`. Usage here is illustrative; the addon is experimental.

```typescript
import { importRecordBatch } from 'node-arrow-c-data';

// Assume you got these pointers from a native library (e.g., ADBC via FFI)
const schemaPtr: bigint = ...; 
const arrayPtr: bigint = ...;

// Import as a standard Apache Arrow RecordBatch
const batch = importRecordBatch(schemaPtr, arrayPtr);

console.log(batch.numRows); // e.g. 1000
console.log(batch.schema.toString());
console.log(batch.toJSON());
```

### 2. Consuming an Arrow Stream (ADBC Result Set)

The standard way to consume database results in Arrow is via `ArrowArrayStream`. Usage here is illustrative; the addon is experimental.

```typescript
import { importRecordBatchStream } from 'node-arrow-c-data';

// Pointer to an initialized ArrowArrayStream struct
const streamPtr: bigint = ...;

// Returns a high-level Reader that behaves like Apache Arrow's RecordBatchReader
const reader = importRecordBatchStream(streamPtr);

// The schema is available synchronously immediately
console.log(reader.schema);

// Iterate over the stream asynchronously
for await (const batch of reader) {
    console.log(`Received batch with ${batch.numRows} rows`);
    // 'batch' is a standard arrow.RecordBatch
}

// The underlying C stream is automatically released when iteration finishes
// or if you break/throw from the loop.
```

### 3. Low-Level Vector Import

If you are working with flat arrays (not struct/table) or want a raw `Vector`:

```typescript
import { importVector } from 'node-arrow-c-data';

const vector = importVector(schemaPtr, arrayPtr);
// vector is an arrow.Vector<T>
```

## Memory Management & Safety

This library uses a strict **Ownership Transfer** model (experimental caveats apply).

1.  **Handover:** When you pass a `bigint` pointer to `import*` functions, you are **transferring ownership** of that C struct to this library.
2.  **Lifecycle:** The pointer is wrapped in an internal `Arrow*Handle` and registered with the V8 Garbage Collector (via `FinalizationRegistry`).
3.  **Release:** When the resulting JavaScript object (e.g., `RecordBatch` or `Reader`) is garbage collected, the library automatically calls the underlying C level `release()` callback.

**⚠️ Warning:**
*   **Do NOT** manually free the memory (e.g., `free()`) of the pointers passed to this library. A double-free will crash the process.
*   **Do NOT** reuse the pointers after passing them to an import function.

### Build & Test

```bash
# Install dependencies
npm install

# Build (Debug mode with Test Fixtures enabled)
npm run build:debug

# Run Tests
npm test
```

### Formatting
```bash
npm run lint:cpp
```

