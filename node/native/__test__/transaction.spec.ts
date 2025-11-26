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
import { withSqlite } from './test_utils';

test('transaction: commit and rollback', async (t) => {
  await withSqlite(async (db, conn, stmt) => {
    // Disable autocommit
    conn.setAutoCommit(false);

    await stmt.setSqlQuery("CREATE TABLE tx_test (id INTEGER)");
    await stmt.executeUpdate();
    await conn.commit(); // Commit the CREATE TABLE

    // Transaction 1
    await stmt.setSqlQuery("INSERT INTO tx_test (id) VALUES (1)");
    await stmt.executeUpdate();

    await conn.rollback();
    t.pass("Rollback successful");

    // Verify empty
    await stmt.setSqlQuery("SELECT * FROM tx_test");
    let reader = await stmt.executeQuery();
    let count = 0;
    for await (const batch of reader) count += batch.numRows;
    t.is(count, 0, "Table should be empty after rollback");

    // Commit test
    // Transaction 2
    // Use a new statement to be safe after rollback (as we discovered earlier)
    const statement3 = await conn.createStatement();
    await statement3.setSqlQuery("INSERT INTO tx_test (id) VALUES (2)");
    await statement3.executeUpdate();

    await conn.commit();
    t.pass("Commit successful");

    // Verify 1 row
    await statement3.setSqlQuery("SELECT * FROM tx_test");
    reader = await statement3.executeQuery();
    count = 0;
    for await (const batch of reader) count += batch.numRows;
    t.is(count, 1, "Table should have 1 row after commit");
    await statement3.close();
  });
});
