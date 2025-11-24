# Node ADBC prototypes (two architectures)

This repo contains two experimental approaches to get Arrow data into Node/TypeScript:

1) **C Data Interface + JS bindings (raw N-API)**  
   - Native addon that exposes ADBC C driver manager bindings over raw N-API.  
   - JavaScript/TypeScript layer builds Arrow objects from Arrow C Data Interface pointers (zero-copy).  
   - Pros: zero-copy into Arrow JS; uses existing C drivers.  
   - Cons: more lifetime/GC complexity and raw N-API plumbing; larger surface to harden.

2) **napi-rs wrapping the Rust ADBC driver manager (IPC)**  
   - napi-rs addon that calls the Rust `adbc_driver_manager` and streams Arrow IPC to JS.  
   - JavaScript/TypeScript parses IPC with `apache-arrow`.  
   - Pros: simpler interop and lifetimes; Arrow layout handled in Rust; aligns with Rust ADBC stack.  
   - Cons: IPC adds a serialize/parse step; requires Rust toolchain for native builds/prebuilds.

Both are prototypes for exploration; APIs and implementations are subject to change.
