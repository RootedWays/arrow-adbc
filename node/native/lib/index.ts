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
    NativeAdbcStatement,
    NativeAdbcStatementIterator,
    NativeAdbcConnectionResultIterator
} from '../binding.js';

import type {
    AdbcDatabase as AdbcDatabaseInterface,
    AdbcConnection as AdbcConnectionInterface,
    AdbcStatement as AdbcStatementInterface,
    ConnectOptions,
    QueryOptions,
    GetObjectsOptions,
} from 'adbc-shared';

import { AdbcInfoCode } from 'adbc-shared';

import { RecordBatchReader, RecordBatch, Table, tableToIPC, Schema } from 'apache-arrow';

// Polyfill Symbol.asyncDispose for Node.js < 20
// This must run before any class definitions that use it.
if (!(Symbol as any).asyncDispose) {
    (Symbol as any).asyncDispose = Symbol.for('Symbol.asyncDispose');
}

// Export Options types
export type { ConnectOptions, QueryOptions, GetObjectsOptions };
export { AdbcInfoCode };

function iteratorToAsyncIterable(iterator: NativeAdbcStatementIterator | NativeAdbcConnectionResultIterator): AsyncIterable<Uint8Array> {
    return {
        [Symbol.asyncIterator]: async function* () {
            try {
                while (true) {
                    const chunk = await iterator.next();
                    if (!chunk) {
                        break;
                    }
                    yield new Uint8Array(chunk as any);
                }
            } finally {
                iterator.close();
            }
        }
    };
}

/**
 * Represents an ADBC Database.
 *
 * An AdbcDatabase represents a handle to a database. This may be a single file (SQLite),
 * a connection configuration (PostgreSQL), or an in-memory database.
 * It holds state that is shared across multiple connections.
 */
export class AdbcDatabase implements AdbcDatabaseInterface {
    private _inner: NativeAdbcDatabase;

    constructor(options: ConnectOptions) {
        this._inner = new NativeAdbcDatabase(options);
    }

    /**
     * Open a new connection to the database.
     * @returns A Promise resolving to a new AdbcConnection.
     */
    async connect(): Promise<AdbcConnection> {
        // Native connect is async
        const connInner = await this._inner.connect(null);
        // Cast to concrete Native type if TS infers unknown
        return new AdbcConnection(connInner as NativeAdbcConnection);
    }

    /**
     * Release the database resources.
     */
    async close(): Promise<void> {
        await this._inner.close();
    }

    /**
     * Release resources when using `await using` syntax.
     */
    async [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }
}

/**
 * Represents a single connection to a database.
 *
 * An AdbcConnection maintains the state of a connection to the database, such as
 * current transaction state and session options.
 */
export class AdbcConnection implements AdbcConnectionInterface {
    private _inner: NativeAdbcConnection;

    constructor(inner: NativeAdbcConnection) {
        this._inner = inner;
    }

    /**
     * Create a new statement for executing queries.
     * @returns A Promise resolving to a new AdbcStatement.
     */
    async createStatement(): Promise<AdbcStatement> {
        const stmtInner = await this._inner.createStatement();
        return new AdbcStatement(stmtInner as NativeAdbcStatement);
    }

    /**
     * Set an option on the connection.
     * @param key The option name.
     * @param value The option value.
     */
    setOption(key: string, value: string): void {
        this._inner.setOption(key, value);
    }

    /**
     * Toggle autocommit behavior.
     * @param enabled Whether autocommit should be enabled.
     */
    setAutoCommit(enabled: boolean): void {
        this.setOption("autocommit", enabled ? "true" : "false");
    }

    /**
     * Toggle read-only mode.
     * @param enabled Whether the connection should be read-only.
     */
    setReadOnly(enabled: boolean): void {
        this.setOption("readonly", enabled ? "true" : "false");
    }

    /**
     * Get a hierarchical view of database objects.
     * @param options Filtering options.
     * @returns A RecordBatchReader containing the metadata.
     */
    async getObjects(options?: GetObjectsOptions): Promise<RecordBatchReader> {
        const iterable = await this.getObjectsWithBuffers(options);
        return RecordBatchReader.from(iterable);
    }

    /**
     * Get a hierarchical view of database objects as raw IPC buffers.
     * @param options Filtering options.
     * @returns An AsyncIterable of IPC buffers (Uint8Array).
     */
    async getObjectsWithBuffers(options?: GetObjectsOptions): Promise<AsyncIterable<Uint8Array>> {
        const opts = {
            depth: options?.depth ?? 0,
            catalog: options?.catalog,
            dbSchema: options?.dbSchema,
            tableName: options?.tableName,
            tableType: options?.tableType,
            columnName: options?.columnName
        };
        const iterator = await this._inner.getObjects(opts);
        return iteratorToAsyncIterable(iterator as NativeAdbcConnectionResultIterator);
    }

    /**
     * Get the Arrow schema for a specific table.
     * @param options An object containing catalog, dbSchema, and tableName.
     * @param options.catalog The catalog name (or undefined).
     * @param options.dbSchema The schema name (or undefined).
     * @param options.tableName The table name.
     * @returns A Promise resolving to the Arrow Schema.
     */
    async getTableSchema(options: { catalog?: string; dbSchema?: string; tableName: string }): Promise<Schema> {
        const buffer = await this._inner.getTableSchema(options);
        // buffer should be Buffer (Uint8Array)
        const reader = RecordBatchReader.from(buffer as Uint8Array);
        if (!reader.schema) {
             await reader.next();
        }
        return reader.schema;
    }

    /**
     * Get a list of table types supported by the database.
     * @returns A RecordBatchReader containing table types.
     */
    async getTableTypes(): Promise<RecordBatchReader> {
        const iterable = await this.getTableTypesWithBuffers();
        return RecordBatchReader.from(iterable);
    }

    /**
     * Get a list of table types supported by the database as raw IPC buffers.
     * @returns An AsyncIterable of IPC buffers (Uint8Array).
     */
    async getTableTypesWithBuffers(): Promise<AsyncIterable<Uint8Array>> {
        const iterator = await this._inner.getTableTypes();
        return iteratorToAsyncIterable(iterator as NativeAdbcConnectionResultIterator);
    }

    /**
     * Get metadata about the driver and database.
     * @param infoCodes Optional list of integer info codes.
     * @returns A RecordBatchReader containing the requested info.
     */
    async getInfo(infoCodes?: number[]): Promise<RecordBatchReader> {
        const iterable = await this.getInfoWithBuffers(infoCodes);
        return RecordBatchReader.from(iterable);
    }

    /**
     * Get metadata about the driver and database as raw IPC buffers.
     * @param infoCodes Optional list of integer info codes.
     * @returns An AsyncIterable of IPC buffers (Uint8Array).
     */
    async getInfoWithBuffers(infoCodes?: number[]): Promise<AsyncIterable<Uint8Array>> {
        const iterator = await this._inner.getInfo(infoCodes);
        return iteratorToAsyncIterable(iterator as NativeAdbcConnectionResultIterator);
    }

    /**
     * Commit any pending transactions.
     */
    async commit(): Promise<void> {
        await this._inner.commit();
    }

    /**
     * Rollback any pending transactions.
     */
    async rollback(): Promise<void> {
        await this._inner.rollback();
    }

    /**
     * Close the connection.
     */
    async close(): Promise<void> {
        await this._inner.close();
    }

    /**
     * Release resources when using `await using` syntax.
     */
    async [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }
}

/**
 * Represents a query statement.
 *
 * An AdbcStatement is used to execute SQL queries or prepare bulk insertions.
 */
export class AdbcStatement implements AdbcStatementInterface {
    private _inner: NativeAdbcStatement;

    constructor(inner: NativeAdbcStatement) {
        this._inner = inner;
    }

    /**
     * Set the SQL query string.
     * @param query The SQL query.
     */
    async setSqlQuery(query: string): Promise<void> {
        this._inner.setSqlQuery(query);
    }

    /**
     * Set an option on the statement.
     * @param key The option name.
     * @param value The option value.
     */
    setOption(key: string, value: string): void {
        this._inner.setOption(key, value);
    }

    /**
     * Execute the query and return a stream of results.
     * @returns A Promise resolving to an Apache Arrow RecordBatchReader.
     */
    async executeQuery(): Promise<RecordBatchReader> {
        const iterable = await this.executeQueryWithBuffers();
        return RecordBatchReader.from(iterable);
    }

    /**
     * Execute the query and return a stream of raw IPC buffers.
     * @returns A Promise resolving to an AsyncIterable of IPC buffers (Uint8Array).
     */
    async executeQueryWithBuffers(): Promise<AsyncIterable<Uint8Array>> {
        const iterator = await this._inner.executeQuery();
        return iteratorToAsyncIterable(iterator as NativeAdbcStatementIterator);
    }

    /**
     * Execute an update command (e.g., INSERT, UPDATE, DELETE) that returns no data.
     * @returns A Promise resolving to the number of rows affected.
     */
    async executeUpdate(): Promise<number | bigint> {
        const rows = await this._inner.executeUpdate();
        return rows as number;
    }

    /**
     * Bind parameters or data for ingestion.
     * @param data Arrow RecordBatch or Table containing the data to bind.
     */
    async bind(data: RecordBatch | Table): Promise<void> {
          console.log('GETS HERE 8f')
        let table: Table;
        if (data instanceof Table) {
          console.log('IS A TABLE')
            table = data;
        } else {
          console.log('IS NOT A TABLE')
            table = new Table(data);
        }

        const ipcBytes = tableToIPC(table, "stream");
        await this._inner.bind(Buffer.from(ipcBytes));
    }

    /**
     * Close the statement.
     */
    async close(): Promise<void> {
        await this._inner.close();
    }

    /**
     * Release resources when using `await using` syntax.
     */
    async [Symbol.asyncDispose](): Promise<void> {
        return this.close();
    }
}
