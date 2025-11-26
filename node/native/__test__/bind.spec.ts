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

import test from 'ava';
import { withSqlite, createTestTable } from './test_utils';
import { tableFromArrays } from 'apache-arrow';

test('statement: bind and query data', async (t) => {
  await withSqlite(async (db, conn, stmt) => {
    // Create a table
    await createTestTable(stmt, "my_table");
    t.pass("Table created");

    // Prepare data to bind using tableFromArrays
    const recordBatchToBind = tableFromArrays({
        id: [null],
        name: ["test_name"]
    });

    t.is(recordBatchToBind.numRows, 1, "Table to bind has 1 row");
    // Bind data
    await stmt.bind(recordBatchToBind);
    t.pass("Data bound successfully");

    // Execute an insert (this will consume the bound data)
    await stmt.setSqlQuery("INSERT INTO my_table (id, name) VALUES (?, ?)"); // ADBC uses ? for parameters
    const insertResult = await stmt.executeUpdate();
    t.is(insertResult, 1, "INSERT should return 1 row affected");
    t.pass("Data inserted");

    // Query the data back
    await stmt.setSqlQuery("SELECT id, name FROM my_table");
    const reader = await stmt.executeQuery();
    t.pass("Executed SELECT query");

    let rowCount = 0;
    for await (const batch of reader) {
        t.pass(`Read batch with ${batch.numRows} rows`);
        rowCount += batch.numRows;
        const idVector = batch.getChild("id");
        const nameVector = batch.getChild("name");

        t.is(idVector?.get(0), null, "ID should be null");
        t.is(nameVector?.get(0), "test_name", "Name should be 'test_name'");
    }

    t.is(rowCount, 1, "Should have retrieved 1 row");
    t.pass("Data verified");
  });
});