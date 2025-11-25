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
import { tableFromArrays } from 'apache-arrow';

import { AdbcDatabase } from '../lib/index.ts';

test('statement: bind and query data', async (t) => {
  const driverPath = getDriverPath("adbc_driver_sqlite");

  let database;
  let connection;
  let statement;

  try {
    database = new AdbcDatabase({
        driver: driverPath,
        entrypoint: "AdbcDriverSQLiteInit"
    });
    t.pass("Created Database");

    connection = await database.connect();
    t.pass("Connected");

    statement = await connection.createStatement();
    t.pass("Created Statement");

    // Create a table
    await statement.setSqlQuery("CREATE TABLE my_table (id INTEGER, name TEXT)");
    const createResult = await statement.executeUpdate();
    t.is(createResult, 0, "CREATE TABLE should return 0 rows affected");
    t.pass("Table created");

    // Prepare data to bind using tableFromArrays
    const recordBatchToBind = tableFromArrays({
        id: [null],
        name: ["test_name"]
    });

    t.is(recordBatchToBind.numRows, 1, "Table to bind has 1 row");
    // Bind data
    await statement.bind(recordBatchToBind);
    t.pass("Data bound successfully");

    // Execute an insert (this will consume the bound data)
    await statement.setSqlQuery("INSERT INTO my_table (id, name) VALUES (?, ?)"); // ADBC uses ? for parameters
    const insertResult = await statement.executeUpdate();
    t.is(insertResult, 1, "INSERT should return 1 row affected");
    t.pass("Data inserted");

    // Query the data back
    await statement.setSqlQuery("SELECT id, name FROM my_table");
    const reader = await statement.executeQuery();
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

  } catch (e) {
    console.error("Error:", e);
    t.fail(`Test failed with error: ${e}`);
  } finally {
    if (statement) await statement.close();
    if (connection) await connection.close();
    if (database) await database.close();
  }
});