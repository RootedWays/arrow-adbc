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

test('options: connection setOption', async (t) => {
    const { conn } = t.context;

    // Test setting autocommit explicitly via string (Supported by SQLite)
    t.notThrows(() => {
        conn.setOption("autocommit", "true");
    });

    // Test setting readonly explicitly (Not supported by SQLite driver at runtime)
    const errorReadOnly = t.throws(() => {
        conn.setOption("readonly", "false");
    });
    t.true(errorReadOnly instanceof AdbcError, "Should throw AdbcError");
    if (errorReadOnly instanceof AdbcError) {
        t.is(errorReadOnly.code, "NotImplemented", "Code should be NotImplemented");
        t.regex(errorReadOnly.message, /Unknown connection option/i);
    }

    // Test setting generic option (SQLite driver is strict and rejects unknown options)
    const errorCustom = t.throws(() => {
        conn.setOption("custom_option", "custom_value");
    });
    t.true(errorCustom instanceof AdbcError, "Should throw AdbcError");
    if (errorCustom instanceof AdbcError) {
        t.is(errorCustom.code, "NotImplemented", "Code should be NotImplemented");
    }
});

test('options: statement setOption', async (t) => {
    const { stmt } = t.context;

    // Test setting an unknown statement option (SQLite driver is strict)
    const error = t.throws(() => {
        stmt.setOption("adbc.stmt.some_option", "value");
    });
    t.true(error instanceof AdbcError, "Should throw AdbcError");
    if (error instanceof AdbcError) {
        t.is(error.code, "NotImplemented", "Code should be NotImplemented");
        t.regex(error.message, /Unknown statement option/i);
    }
});
