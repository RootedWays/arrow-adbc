// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import test from 'ava'
import * as path from 'path';
import * as process from 'process';
import { fileURLToPath } from 'url';

import { AdbcDatabase } from '../index.js'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('basic dummy driver test', (t) => {
  const platform = process.platform;
  let libName = 'libadbc_dummy.so';
  if (platform === 'darwin') {
    libName = 'libadbc_dummy.dylib';
  } else if (platform === 'win32') {
    libName = 'adbc_dummy.dll';
  }

  // Adjust path to find the rust binary from the test directory
  // node/native/__test__ -> node/native -> node -> root -> rust/target/debug
  const driverPath = path.join(__dirname, '../../../rust/target/debug', libName);
  console.log(`Loading driver from: ${driverPath}`);

  try {
    const db = new AdbcDatabase(driverPath, "DummyDriverInit");
    t.pass("Database created successfully");
    
    const conn = db.connection();
    t.pass("Connection created successfully");
    
    const stmt = conn.statement();
    t.pass("Statement created successfully");
    
    stmt.setSqlQuery("SELECT * FROM whatever");
    t.pass("Query set successfully");
    
    const res = stmt.execute();
    t.pass("Executed successfully");
    t.is(res, 0);
    
  } catch (e) {
    console.error("Error:", e);
    t.fail(`Test failed with error: ${e}`);
  }
})
