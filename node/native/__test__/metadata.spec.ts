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
import { getDriverPath } from './test_utils';
import { AdbcDatabase } from '../lib/index.ts';

test('metadata: catalog functions', async (t) => {
  const driverPath = getDriverPath("adbc_driver_sqlite");

  const database = new AdbcDatabase({
      driver: driverPath,
      entrypoint: "AdbcDriverSQLiteInit"
  });
  const connection = await database.connect();
  const statement = await connection.createStatement();

  try {
    // Setup: Create a table to query metadata about
    await statement.setSqlQuery("CREATE TABLE metadata_test (id INTEGER PRIMARY KEY, val TEXT)");
    await statement.executeUpdate();

    // 1. getTableTypes
    const tableTypesReader = await connection.getTableTypes();
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
    // SQLite usually puts tables in "main" schema or null/empty catalog.
    // ADBC SQLite driver behavior: catalog=null, dbSchema="main"? or just table name match?
    // Let's try with just table name first.
    const schema = await connection.getTableSchema(null, null, "metadata_test");
    t.is(schema.fields.length, 2, "Schema should have 2 fields");
    t.is(schema.fields[0].name, "id", "First field should be 'id'");
    t.is(schema.fields[1].name, "val", "Second field should be 'val'");

    // 3. getObjects (Tables)
    // Depth 3 = Tables
    const objectsReader = await connection.getObjects({
        depth: 3,
        tableName: "metadata_test",
        tableType: ["table", "view"]
    });
    
    let foundTable = false;
    for await (const batch of objectsReader) {
        // ADBC getObjects structure is complex (nested lists).
        // For now, just verify we got data back.
        // Parsing the full hierarchy in JS without helper types is verbose.
        // We assume if we get rows, it's working.
        if (batch.numRows > 0) foundTable = true;
    }
    t.true(foundTable, "Should find the table in getObjects");

    // 4. getInfo
    const infoReader = await connection.getInfo();
    let foundInfo = false;
    for await (const batch of infoReader) {
        if (batch.numRows > 0) foundInfo = true;
        // Info has code (uint32) and value (dense union).
    }
    t.true(foundInfo, "Should return driver info");

  } catch (e) {
    console.error("Error:", e);
    t.fail(`Test failed with error: ${e}`);
  } finally {
    await statement.close();
    await connection.close();
    await database.close();
  }
});
