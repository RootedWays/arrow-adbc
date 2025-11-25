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
    AdbcDatabase as AdbcDatabaseInterface, 
    AdbcConnection as AdbcConnectionInterface, 
    AdbcStatement as AdbcStatementInterface, 
    ConnectOptions, 
    QueryOptions,
    GetObjectsOptions
} from '../../shared/src/index';

import { RecordBatchReader, RecordBatch, Table, tableToIPC, Schema } from 'apache-arrow';

// Export Options types
export type { ConnectOptions, QueryOptions, GetObjectsOptions };

// Safely define Symbol.asyncDispose for compatibility with Node.js environments older than v21.
// This allows the use of `await using` syntax if the environment supports it (e.g., Node.js v21+)
// or if a polyfill is provided. If the Symbol is not natively available, a unique Symbol is
// created to prevent runtime errors, though `await using` won't function.
const asyncDisposeSymbol = (Symbol as any).asyncDispose ?? Symbol('Symbol.asyncDispose');

export class AdbcDatabase implements AdbcDatabaseInterface {
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

    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}

export class AdbcConnection implements AdbcConnectionInterface {
    private _inner: NativeAdbcConnection;

    constructor(inner: NativeAdbcConnection) {
        this._inner = inner;
    }

    async createStatement(): Promise<AdbcStatement> {
        const stmtInner = this._inner.createStatement();
        return new AdbcStatement(stmtInner);
    }

    async getObjects(options?: GetObjectsOptions): Promise<RecordBatchReader> {
        // Ensure defaults for optional fields to match native expectation
        const opts = {
            depth: options?.depth ?? 0, // Default to 0 (All) if undefined
            catalog: options?.catalog,
            dbSchema: options?.dbSchema,
            tableName: options?.tableName,
            tableType: options?.tableType,
            columnName: options?.columnName
        };
        const iterator = this._inner.getObjects(opts);
        return this._iteratorToReader(iterator);
    }

    async getTableSchema(catalog: string | null, dbSchema: string | null, tableName: string): Promise<Schema> {
        const buffer = this._inner.getTableSchema(catalog, dbSchema, tableName);
        const reader = RecordBatchReader.from(buffer);
        
        // In some versions, schema might be lazy. Ensure we have it.
        if (!reader.schema) {
            await reader.next(); // Trigger read
        }
        
        return reader.schema;
    }

    async getTableTypes(): Promise<RecordBatchReader> {
        const iterator = this._inner.getTableTypes();
        return this._iteratorToReader(iterator);
    }

    async getInfo(infoCodes?: number[]): Promise<RecordBatchReader> {
        const iterator = this._inner.getInfo(infoCodes);
        return this._iteratorToReader(iterator);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    async [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }

    private async _iteratorToReader(iterator: any): Promise<RecordBatchReader> {
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
}

export class AdbcStatement implements AdbcStatementInterface {
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
        // Cast the return value from native (number) to number|bigint
        return this._inner.executeUpdate();
    }

    async bind(data: RecordBatch | Table): Promise<void> {
        let table: Table;
        if (data instanceof Table) {
            table = data;
        } else {
            table = new Table(data);
        }

        const ipcBytes = tableToIPC(table, "stream");
        this._inner.bind(Buffer.from(ipcBytes));
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}
