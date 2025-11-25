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

import { 
    NativeAdbcDatabase, 
    NativeAdbcConnection, 
    NativeAdbcStatement
} from '../binding.js';

import type { 
    AdbcDatabase, 
    AdbcConnection, 
    AdbcStatement, 
    ConnectOptions, 
    QueryOptions 
} from '../../shared/src/index';

import { RecordBatchReader } from 'apache-arrow';

// Re-export types
export type { ConnectOptions, QueryOptions, AdbcDatabase, AdbcConnection, AdbcStatement };

export class AdbcDatabaseImpl implements AdbcDatabase {
    private _inner: NativeAdbcDatabase;

    constructor(options: ConnectOptions) {
        this._inner = new NativeAdbcDatabase(options);
    }

    async connect(): Promise<AdbcConnection> {
        // TODO: Pass options to connect if needed
        const connInner = this._inner.connect(null); 
        return new AdbcConnectionImpl(connInner);
    }

    async close(): Promise<void> {
        // Native object doesn't expose close yet, rely on GC/Drop
        return Promise.resolve();
    }
}

export class AdbcConnectionImpl implements AdbcConnection {
    private _inner: NativeAdbcConnection;

    constructor(inner: NativeAdbcConnection) {
        this._inner = inner;
    }

    async createStatement(): Promise<AdbcStatement> {
        const stmtInner = this._inner.createStatement();
        return new AdbcStatementImpl(stmtInner);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

export class AdbcStatementImpl implements AdbcStatement {
    private _inner: NativeAdbcStatement;

    constructor(inner: NativeAdbcStatement) {
        this._inner = inner;
    }

    async setSqlQuery(query: string): Promise<void> {
        this._inner.setSqlQuery(query);
    }

    async setOption(key: string, value: string): Promise<void> {
        this._inner.setOption(key, value);
    }

    async executeQuery(): Promise<RecordBatchReader> {
        const iterator = this._inner.executeQuery();
        
        const asyncIterable: AsyncIterable<Uint8Array> = {
            [Symbol.asyncIterator]: async function* () {
                while (true) {
                    const chunk = await iterator.next();
                    if (!chunk) {
                        break;
                    }
                    yield new Uint8Array(chunk as any);
                }
                // iterator.close(); // Native iterator doesn't expose close yet?
            }
        };

        return RecordBatchReader.from(asyncIterable);
    }

    async executeUpdate(): Promise<number | bigint> {
        return this._inner.executeUpdate();
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

// Factory function to create a database
export function createDatabase(options: ConnectOptions): AdbcDatabase {
    return new AdbcDatabaseImpl(options);
}