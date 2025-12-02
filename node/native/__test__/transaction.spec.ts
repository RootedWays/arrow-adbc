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

import anyTest, { TestFn } from 'ava';
import { createSqliteDatabase, createTestTable } from './test_utils';
import { AdbcDatabase, AdbcConnection, AdbcStatement } from '../lib/index.js';

interface TestContext {
  db: AdbcDatabase;
  conn: AdbcConnection;
  stmt: AdbcStatement;
}

const test = anyTest as TestFn<TestContext>;

test.before(async (t) => {
  const db = await createSqliteDatabase();
  const conn = await db.connect();
  const stmt = await conn.createStatement();
  await createTestTable(stmt, "tx_test");
  t.context = { db, conn, stmt };
});

test.after.always(async (t) => {
  try {
    if (t.context.stmt) await t.context.stmt.close();
    if (t.context.conn) await t.context.conn.close();
    if (t.context.db) await t.context.db.close();
  } catch (e) {
    // ignore
  }
});

test.serial('transaction: rollback reverts changes', async (t) => {
    const { conn } = t.context; // Use conn from context
    conn.setAutoCommit(false);

    // Create a new statement for this transaction block to ensure isolation
    const newStmt = await conn.createStatement();
    try {
        await newStmt.setSqlQuery("INSERT INTO tx_test (id) VALUES (1)");
        await newStmt.executeUpdate();

        await conn.rollback();
        t.pass("Rollback successful");

        await newStmt.setSqlQuery("SELECT * FROM tx_test");
        let reader = await newStmt.executeQuery();
        let count = 0;
        for await (const batch of reader) count += batch.numRows;
        t.is(count, 0, "Table should be empty after rollback");
    } finally {
        await newStmt.close();
    }
});

test.serial('transaction: commit persists changes', async (t) => {
    const { conn } = t.context; // Note: using conn from context, but creating new statement.
    conn.setAutoCommit(false); // Ensure autocommit is off

    // Create a new statement for this test to ensure isolation, as per original test's cautious approach.
    const newStmt = await conn.createStatement();
    try {
        await newStmt.setSqlQuery("INSERT INTO tx_test (id) VALUES (2)");
        const affectedRows = await newStmt.executeUpdate();
        t.is(affectedRows, 1, "INSERT should affect 1 row");

        // Verify row is visible before commit (within the transaction)
        await newStmt.setSqlQuery("SELECT * FROM tx_test");
        let readerBeforeCommit = await newStmt.executeQuery();
        let countBeforeCommit = 0;
        for await (const batch of readerBeforeCommit) countBeforeCommit += batch.numRows;
        t.is(countBeforeCommit, 1, "Table should have 1 row before commit");

        await conn.commit();
        t.pass("Commit successful");
        
        // ADBC Spec: "Calling commit or rollback on the connection may invalidate active statements."
        // To ensure robust verification, create a fresh statement to read back the committed data.
        const verifyStmt = await conn.createStatement();
        try {
            await verifyStmt.setSqlQuery("SELECT * FROM tx_test");
            let reader = await verifyStmt.executeQuery();
            let count = 0;
            for await (const batch of reader) count += batch.numRows;
            t.is(count, 1, "Table should have 1 row after commit");
        } finally {
            await verifyStmt.close();
        }
    } finally {
        await newStmt.close();
    }
});