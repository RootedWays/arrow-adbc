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
    AdbcDatabase as AdbcDatabaseType,
    AdbcConnection as AdbcConnectionType,
    AdbcStatement as AdbcStatementType,
    ConnectOptions,
    QueryOptions
} from '../../shared/src/index';

import { RecordBatch, RecordBatchReader, Table, tableToIPC } from 'apache-arrow';

// Re-export types
export type { ConnectOptions, QueryOptions };

export class AdbcDatabase implements AdbcDatabaseType {
    private _inner: NativeAdbcDatabase;

    constructor(options: ConnectOptions) {
        this._inner = new NativeAdbcDatabase(options);
    }

    async connect(): Promise<AdbcConnection> {
        const connInner = this._inner.connect(null);
        return new AdbcConnection(connInner);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

export class AdbcConnection implements AdbcConnectionType {
    private _inner: NativeAdbcConnection;

    constructor(inner: NativeAdbcConnection) {
        this._inner = inner;
    }

    async createStatement(): Promise<AdbcStatement> {
        const stmtInner = this._inner.createStatement();
        return new AdbcStatement(stmtInner);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

export class AdbcStatement implements AdbcStatementType {
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
            }
        };

        return RecordBatchReader.from(asyncIterable);
    }

    async executeUpdate(): Promise<number | bigint> {
        return this._inner.executeUpdate();
    }

    async bind(data: RecordBatch | Table): Promise<void> {
        // Serialize to IPC bytes
        // tableToIPC works for Table. For RecordBatch, we might need to wrap it in a Table or use RecordBatchStreamWriter manually?
        // tableToIPC takes Table | RecordBatch[].
        
        let table: Table;
        if (data instanceof Table) {
            table = data;
        } else {
            // Wrap single batch in a Table/list
            table = new Table(data);
        }

        const ipcBytes = tableToIPC(table, "stream");
        // Pass buffer to native
        // We need to expose bind(buffer) in NativeAdbcStatement
        this._inner.bind(Buffer.from(ipcBytes));
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}