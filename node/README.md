<!---
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Apache Arrow ADBC: Node.js Bindings

This directory contains the Node.js implementation of the [Arrow Database Connectivity (ADBC)](https://arrow.apache.org/adbc/) standard.

## Project Structure

- **[`native`](./native)**: The primary package (`adbc-node`). This is a Node.js native addon (using [N-API](https://nodejs.org/api/n-api.html)) built with Rust. It provides the ADBC Driver Manager interface.
- **[`core`](./core)**: Internal Rust crate containing shared logic and type definitions used by the native bindings.

## Getting Started

To use the ADBC driver in your Node.js project, see the documentation in the **[`native`](./native)** directory.

## Building from Source

This project uses `npm` workspaces and Rust.

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Build the project:**
    ```bash
    npm run build
    ```
    This command builds the Rust native modules and the TypeScript wrappers.

3.  **Run Tests:**
    ```bash
    npm test
    ```
