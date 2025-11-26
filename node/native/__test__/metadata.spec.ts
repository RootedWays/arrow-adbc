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

test('metadata: catalog functions', async (t) => {
  await withSqlite(async (db, conn, stmt) => {
    // Setup: Create a table to query metadata about
    await createTestTable(stmt, "metadata_test");

    // 1. getTableTypes
    const tableTypesReader = await conn.getTableTypes();
    let tableTypesCount = 0;
    let foundTableType = false;
    for await (const batch of tableTypesReader) {
        tableTypesCount += batch.numRows;
        const typeVector = batch.getChild("table_type");
        if (typeVector) {
            for (let i = 0; i < batch.numRows; i++) {
                if (typeVector.get(i) === "table") foundTableType = true;
            }
        }
    }
    t.true(tableTypesCount > 0, "Should return at least one table type");
    t.true(foundTableType, "Should contain 'table' type");

    // 2. getTableSchema
    const schema = await conn.getTableSchema({ catalog: undefined, dbSchema: undefined, tableName: "metadata_test" });
    t.is(schema.fields.length, 2, "Schema should have 2 fields");
    t.is(schema.fields[0].name, "id", "First field should be 'id'");
    t.is(schema.fields[1].name, "name", "Second field should be 'name'"); // createTestTable uses 'name'

    // 3. getObjects (Tables)
    const objectsReader = await conn.getObjects({
        depth: 3,
        tableName: "metadata_test",
        tableType: ["table", "view"]
    });
    
    let foundTable = false;
    for await (const batch of objectsReader) {
        if (batch.numRows > 0) foundTable = true;
    }
    t.true(foundTable, "Should find the table in getObjects");

    // 4. getInfo
    const infoReader = await conn.getInfo();
    let foundInfo = false;
    for await (const batch of infoReader) {
        if (batch.numRows > 0) foundInfo = true;
    }
    t.true(foundInfo, "Should return driver info");
  });
});
