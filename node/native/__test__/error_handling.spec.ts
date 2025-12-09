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
import { createSqliteDatabase } from './test_utils';
import { AdbcDatabase, AdbcConnection, AdbcStatement, AdbcError } from '../lib/index.js';

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

// Use serial to prevent table name collisions
test.serial('error: invalid sql syntax', async (t) => {
    const { stmt } = t.context;
    await stmt.setSqlQuery("SELECT * FROM"); // Syntax error

    const error = await t.throwsAsync(async () => {
        const reader = await stmt.executeQuery();
        for await (const _ of reader) {}
    });

    t.true(error instanceof AdbcError, "Should be AdbcError");
    if (error instanceof AdbcError) {
        // SQLite might return "Unknown" or "InvalidState" or "Internal" for syntax
        // Let's just check the message content for now
        t.regex(error.message, /syntax error|incomplete input/i);
        t.truthy(error.sqlState, "Should have SQL State");
    }
});

test.serial('error: table not found', async (t) => {
    const { stmt } = t.context;
    await stmt.setSqlQuery("SELECT * FROM non_existent_table");

    const error = await t.throwsAsync(async () => {
        const reader = await stmt.executeQuery();
        for await (const _ of reader) {}
    });

    t.true(error instanceof AdbcError);
    t.regex(error?.message || "", /no such table/i);
});

test.serial('error: constraint violation', async (t) => {
    const { conn } = t.context;

    // Use a dedicated statement for setup
    const setupStmt = await conn.createStatement();
    await setupStmt.setSqlQuery("CREATE TABLE IF NOT EXISTS err_test (id INTEGER PRIMARY KEY)");
    await setupStmt.executeUpdate();

    await setupStmt.setSqlQuery("INSERT INTO err_test (id) VALUES (1)");
    await setupStmt.executeUpdate();
    await setupStmt.close();

    const { stmt } = t.context;
    await stmt.setSqlQuery("INSERT INTO err_test (id) VALUES (1)");
    const error = await t.throwsAsync(async () => {
        await stmt.executeUpdate();
    });

    t.true(error instanceof AdbcError);
    if (error instanceof AdbcError) {
        // SQLite driver currently maps unique constraint violations to 'IO' or 'Integrity'
        t.regex(error.code, /AlreadyExists|Integrity|IO/, "Should be AlreadyExists, Integrity, or IO error");
    }
});

test.serial('error: invalid option', async (t) => {
    const { conn } = t.context;

    const error = t.throws(() => {
        conn.setOption("readonly", "invalid_boolean");
    });

    if (!(error instanceof AdbcError)) {
        t.log("Error is not AdbcError. Message:", error?.message);
    }
    t.true(error instanceof AdbcError);
    if (error instanceof AdbcError) {
        t.is(error.code, "NotImplemented", "Should be NotImplemented for unknown option");
    }
});
