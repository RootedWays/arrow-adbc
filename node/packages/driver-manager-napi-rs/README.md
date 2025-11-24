# driver-manager-napi-rs (experimental)

This package is a prototype napi-rs binding around the Rust ADBC driver manager
and arrow-rs Arrow IPC. The goal is to push Arrow/C Data handling into arrow-rs
and use [napi-rs](https://napi.rs/) for N-API/async integration so we avoid
hand-rolled V8/GC lifetime management and blocking the Node thread. Using
[napi-rs Async Tasks](https://napi.rs/docs/concepts/async-task) keeps work off
the event loop while arrow-rs handles Arrow layout/validation.

## Building locally

```
cd packages/driver-manager-napi-rs
npm run build:native   # release build, copies native/target/release/* -> native/index.node
npm run build:ts       # compile TypeScript wrapper
```

The resulting shared library is placed at `native/index.node`, and compiled JS/DTs at `dist/`.
You can then `require('driver-manager-napi-rs/dist')` to access the exported helpers.
For a debug native build, run `npm run build:native:debug`.

## What’s implemented

- A napi-rs crate that depends on the Rust `adbc_driver_manager` and Arrow IPC crates.
- A TypeScript wrapper that loads the native addon.
- Minimal exports for plumbing tests: a crate/version helper, default load flags, and a sample Arrow IPC stream.

## Proposed TypeScript API (work in progress)

This is the intended driver-like surface to build next. Shapes may evolve, but
the goal is a small, ergonomic API for connecting and streaming results.

```ts
import * as adbc from 'driver-manager-napi-rs';

// Layered API (pool/multi-tenant friendly)
const driver = await adbc.driver({
  driver: 'sqlite',
  searchPaths: ['dist/drivers/lib'],
  entrypoint: undefined,
  loadFlags: undefined,
});

const database = await driver.database({
  options: { uri: 'file:example.db' }, // database-level (uri/credentials/driver-specific)
});

const connection = await database.connect({
  options: { autocommit: 'true' }, // connection-level (autocommit/isolation/catalog/schema/etc.)
});

const stream = await connection.query('SELECT * FROM my_table', {
  params: [],                      // optional; future: Arrow bind/bind_stream
  statementOptions: {},            // optional statement options (queryTimeout, ingestTargetTable, etc.)
}); // returns RecordBatchReader

for await (const batch of stream) {
  // batch is an Apache Arrow JS RecordBatch
}

await connection.close();
await database.close();
await driver.close();

// Convenience one-shot (internally driver -> database -> connection)
// const conn = await adbc.connect({
//   driver: 'sqlite',
//   searchPaths: ['dist/drivers/lib'],
//   databaseOptions: { uri: 'file:example.db' },
//   connectionOptions: { autocommit: 'true' },
// });
// const stream = await conn.query('SELECT 1');
// await conn.close();
```

## Next steps

- Implement `connect()`/`AdbcClient` with real ADBC driver manager calls and IPC streaming.
- Add cross-platform builds and prebuilds via `@napi-rs/cli`.
- Add TypeScript definitions/tests for the full ADBC surface once implemented.
- Expand tests (native load, IPC round-trips, ADBC integration).
