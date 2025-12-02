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
import { AdbcDatabase, AdbcConnection, AdbcStatement } from '../lib/index.js';

interface TestContext {
  // Optional because we might close them during the test
  db?: AdbcDatabase;
  conn?: AdbcConnection;
  stmt?: AdbcStatement;
}

const test = anyTest as TestFn<TestContext>;

test.before(async (t) => {
  const db = await createSqliteDatabase();
  const conn = await db.connect();
  const stmt = await conn.createStatement();
  await stmt.setSqlQuery("SELECT 1 as val");
  t.context = { db, conn, stmt };
});

test.after.always(async (t) => {
  try {
    if (t.context.stmt) await t.context.stmt.close();
  } catch {}
  try {
    if (t.context.conn) await t.context.conn.close();
  } catch {}
  try {
    if (t.context.db) await t.context.db.close();
  } catch {}
});

test('safety: iterator survives connection close', async (t) => {
  // Rationale:
  // The ADBC C API Specification states regarding Resource Management:
  // "Releasing a parent object does not automatically release child objects, but it may invalidate them."
  // (https://arrow.apache.org/adbc/current/c/api/index.html#resource-management)
  //
  // In a raw C application, accessing a Child (Iterator) after closing the Parent (Connection)
  // would often result in a Use-After-Free (Segfault).
  //
  // However, in Node.js, a Segfault is unacceptable. This driver implementation (via the Rust adbc_driver_manager)
  // uses Reference Counting (Arc) to manage the lifecycle of the underlying C structs.
  // When we "Close" the connection in JavaScript, we are releasing the JavaScript handle's
  // reference to the resource.
  //
  // The Iterator (Reader) holds its own strong reference to the underlying Statement/Connection
  // to ensure it can safely finish reading. The actual C-level teardown of the Connection
  // only occurs when *all* references (Connection handle + all active Iterators) are dropped.
  //
  // This test verifies that "Safety" mechanism: ensuring that premature closure of the parent
  // handle does not crash the process or interrupt the child stream.
  const { stmt, conn, db } = t.context;
  
  if (!stmt || !conn || !db) {
      t.fail("Setup failed");
      return;
  }

  // 2. Get Reader (which holds iterator)
  const reader = await stmt.executeQuery();
  t.pass("Got reader");

  // 3. Close Statement and Connection immediately
  // The Iterator (inside Reader) should keep the underlying resources alive.
  await stmt.close();
  // Mark as closed in context so after hook doesn't complain (though we have try/catch)
  delete t.context.stmt;

  await conn.close();
  delete t.context.conn;

  await db.close();
  delete t.context.db;
  
  t.pass("Resources closed");

  // 4. Iterate
  let rowCount = 0;
  for await (const batch of reader) {
      t.pass(`Read batch with ${batch.numRows} rows from orphaned iterator`);
      rowCount += batch.numRows;
      const valVector = batch.getChild("val");
      t.is(valVector?.get(0), 1n);
  }

  t.is(rowCount, 1);
  t.pass("Finished iterating batches from orphaned iterator");
});