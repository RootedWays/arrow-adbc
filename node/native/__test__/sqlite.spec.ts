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
import { getDriverPath } from './test_utils';

// Import the class directly
import { AdbcDatabase } from '../lib/index.ts'

test('sqlite driver test with high-level client', async (t) => {
  const driverPath = getDriverPath("adbc_driver_sqlite");
  console.log(`Loading driver from: ${driverPath}`);

  try {
    // 1. Create Database
    const database = new AdbcDatabase({
        driver: driverPath,
        entrypoint: "AdbcDriverSQLiteInit"
    });
    
    // 2. Connect
    const connection = await database.connect();
    t.pass("Connected successfully");
    
    // 3. Create Statement
    const statement = await connection.createStatement();
    t.pass("Created statement");

    // 4. Execute Query
    await statement.setSqlQuery("SELECT 1 as val");
    const reader = await statement.executeQuery();
    t.pass("Executed query successfully");
    
    let rowCount = 0;
    for await (const batch of reader) {
        t.pass(`Read batch with ${batch.numRows} rows`);
        rowCount += batch.numRows;
        const valVector = batch.getChild("val");
        t.is(valVector?.get(0), 1n);
    }

    t.is(rowCount, 1);
    t.pass("Finished iterating batches");

    await statement.close();
    await connection.close();
    await database.close();
    
  } catch (e) {
    console.error("Error:", e);
    t.fail(`Test failed with error: ${e}`);
  }
})
