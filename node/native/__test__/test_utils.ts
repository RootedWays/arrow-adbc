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

import * as path from 'path';
import * as process from 'process';
import { fileURLToPath } from 'url';
import { AdbcDatabase, AdbcConnection, AdbcStatement } from '../lib/index.js';

// Resolve __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Gets the platform-specific path to a built ADBC driver library.
 * Assumes drivers are built into `node/native/build/lib/` (from `npm run build:driver`).
 *
 * @param driverName The base name of the driver (e.g., "adbc_driver_sqlite").
 * @returns The absolute path to the driver library.
 */
export function getDriverPath(driverName: string): string {
  const platform = process.platform;
  let libName = `lib${driverName}.so`; // Default for Linux
  if (platform === 'darwin') {
    libName = `lib${driverName}.dylib`;
  } else if (platform === 'win32') {
    libName = `${driverName}.dll`;
  }

  // Path from node/native/__test__ to node/native/build/lib
  return path.join(__dirname, '../build/lib', libName);
}

export async function createSqliteDatabase(): Promise<AdbcDatabase> {
  const driverPath = getDriverPath("adbc_driver_sqlite");
  return new AdbcDatabase({
      driver: driverPath,
      entrypoint: "AdbcDriverSQLiteInit"
  });
}

export async function withSqlite(
  callback: (db: AdbcDatabase, conn: AdbcConnection, stmt: AdbcStatement) => Promise<void>
): Promise<void> {
  const db = await createSqliteDatabase();
  const conn = await db.connect();
  const stmt = await conn.createStatement();
  
  try {
    await callback(db, conn, stmt);
  } finally {
    await stmt.close();
    await conn.close();
    await db.close();
  }
}

export async function createTestTable(stmt: AdbcStatement, tableName: string = "test_table"): Promise<void> {
    await stmt.setSqlQuery(`CREATE TABLE ${tableName} (id INTEGER, name TEXT)`);
    await stmt.executeUpdate();
}
