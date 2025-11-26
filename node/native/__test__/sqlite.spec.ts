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

import test from 'ava'

import { withSqlite } from './test_utils';



test('sqlite driver test with high-level client', async (t) => {

  await withSqlite(async (db, conn, stmt) => {

    t.pass("Connected successfully");

    t.pass("Created statement");



    // 4. Execute Query

    await stmt.setSqlQuery("SELECT 1 as val");

    const reader = await stmt.executeQuery();

    t.pass("Executed query successfully");

    

    let rowCount = 0;

    for await (const batch of reader) {

        t.pass(`Read batch with ${batch.numRows} rows`);

        rowCount += batch.numRows;

        const valVector = batch.getChild("val");

        t.is(valVector?.get(0), 1n);

    }



    t.is(rowCount, 1);

    t.pass("Finished iterating batches");

  });

})


