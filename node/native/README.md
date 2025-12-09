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

# Apache Arrow ADBC: Node.js Driver Manager

This package provides Node.js bindings for the [Arrow Database Connectivity (ADBC)](https://arrow.apache.org/adbc/) standard.

**Note: This project is currently under active development.**

## Installation

```bash
npm install adbc-node
```

## Usage

```typescript
import { AdbcDatabase } from 'adbc-node';

// 1. Initialize the Database with a path to an ADBC driver library
//    (e.g., SQLite, PostgreSQL driver shared object/DLL)
const database = new AdbcDatabase({
  driver: "path/to/libadbc_driver_sqlite.so", // or .dylib, .dll
});

// 2. Open a Connection
const connection = await database.connect();

// 3. Create a Statement for a query
const statement = await connection.createStatement();
await statement.setSqlQuery("SELECT 1 AS value");

// 4. Execute the query and get a RecordBatchReader
const reader = await statement.executeQuery();

// 5. Iterate over the Arrow RecordBatches
for await (const batch of reader) {
  console.log(`Received batch with ${batch.numRows} rows`);
  // Process batch using Apache Arrow JS API
}

// 6. Cleanup
await statement.close();
await connection.close();
await database.close();
```

## Development

### Prerequisites

- Node.js 18+
- Rust (latest stable)
- npm (usually comes with Node.js)

### Building from Source

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```
   This command compiles the Rust code and generates the Node.js bindings.

### Testing

Run the test suite:

```bash
npm test
```

## License

Apache-2.0
