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
import { createSqliteDatabase, createTestTable, dumpReader } from './test_utils';
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

  await createTestTable(stmt, "metadata_test");

  t.context = { db, conn, stmt };
});

test.after.always(async (t) => {
  try {
    if (t.context.stmt) await t.context.stmt.close();
    if (t.context.conn) await t.context.conn.close();
    if (t.context.db) await t.context.db.close();
  } catch (e) {
    console.error("Error cleaning up test resources:", e);
  }
});

test('metadata: getTableTypes', async (t) => {
    const { conn } = t.context;
    const tableTypes = await dumpReader(await conn.getTableTypes());

    // Sort actual results for consistent comparison with t.like
    tableTypes.sort((a, b) => (a.table_type || '').localeCompare(b.table_type || ''));

    t.like(tableTypes, [
      { table_type: 'table' },
      { table_type: 'view' },
    ], "Should return expected table types sorted alphabetically");
});

test('metadata: getTableSchema', async (t) => {
    const { conn } = t.context;
    const schema = await conn.getTableSchema({ tableName: "metadata_test" });

    t.like(schema.fields, [
      { name: "id", nullable: true }, // SQLite typically makes INTEGER nullable
      { name: "name", nullable: true }, // TEXT is also nullable by default
    ], "Schema fields should match expected structure");
});

test('metadata: getObjects', async (t) => {
    const { conn } = t.context;
    // SQLite structure: Catalog (null/main) -> Schemas (null/main) -> Tables
    const objects = await dumpReader(await conn.getObjects({
        depth: 3,
        tableName: "metadata_test",
        tableType: ["table", "view"]
    }));

    t.like(objects, [
      {
        catalog_db_schemas: [
          {
            db_schema_tables: [
              {
                table_name: "metadata_test"
              }
            ]
          }
        ]
      }
    ], "Should find 'metadata_test' table in getObjects");
});

test('metadata: getInfo', async (t) => {
    const { conn } = t.context;
    const info = await dumpReader(await conn.getInfo());

    t.like(info[0], { info_name: 0, info_value: 'SQLite' }, "First driver info record should be SQLite driver name");
});
