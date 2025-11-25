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

// Polyfill Symbol.asyncDispose if strictly needed for the test runner, 
// but newer Node versions have it.
if (!(Symbol as any).asyncDispose) {
  (Symbol as any).asyncDispose = Symbol('Symbol.asyncDispose');
}

test('ergonomics: async disposable support', async (t) => {
  const driverPath = getDriverPath("adbc_driver_sqlite");

  try {
    {
        // "await using" block scope
        // Note: 'await using' syntax requires TS 5.2+. 
        // If the test runner or TS version is older, we verify by calling the symbol method directly.
        
        const database = new AdbcDatabase({
            driver: driverPath,
            entrypoint: "AdbcDriverSQLiteInit"
        });
        
        // Manual check since we can't guarantee 'await using' syntax support in this raw script context without build config check
        const dispose = database[Symbol.asyncDispose];
        t.is(typeof dispose, 'function', "Database should have asyncDispose method");

        const connection = await database.connect();
        t.is(typeof connection[Symbol.asyncDispose], 'function', "Connection should have asyncDispose method");

        const statement = await connection.createStatement();
        t.is(typeof statement[Symbol.asyncDispose], 'function', "Statement should have asyncDispose method");

        // Simulate disposal
        await statement[Symbol.asyncDispose]();
        await connection[Symbol.asyncDispose]();
        await database[Symbol.asyncDispose]();
        
        t.pass("Resources disposed manually via symbol");
    }
    t.pass("Disposal checks passed");

  } catch (e) {
    console.error("Error:", e);
    t.fail(`Test failed with error: ${e}`);
  }
});
