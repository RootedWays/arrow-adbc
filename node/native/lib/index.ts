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
    NativeAdbcStatementIterator 
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

// Safely define Symbol.asyncDispose for compatibility with Node.js environments older than v21.
// This allows the use of `await using` syntax if the environment supports it (e.g., Node.js v21+)
// or if a polyfill is provided. If the Symbol is not natively available, a unique Symbol is
// created to prevent runtime errors, though `await using` won't function.
const asyncDisposeSymbol = (Symbol as any).asyncDispose ?? Symbol('Symbol.asyncDispose');

// Export Options types
export type { ConnectOptions, QueryOptions, GetObjectsOptions };

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
    async [asyncDisposeSymbol](): Promise<void> {
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
        const opts = {
            depth: options?.depth ?? 0,
            catalog: options?.catalog,
            dbSchema: options?.dbSchema,
            tableName: options?.tableName,
            tableType: options?.tableType,
            columnName: options?.columnName
        };
        const iterator = await this._inner.getObjects(opts);
        return this._iteratorToReader(iterator as NativeAdbcStatementIterator);
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
        const iterator = await this._inner.getTableTypes();
        return this._iteratorToReader(iterator as NativeAdbcStatementIterator);
    }

    /**
     * Get metadata about the driver and database.
     * @param infoCodes Optional list of integer info codes.
     * @returns A RecordBatchReader containing the requested info.
     */
    async getInfo(infoCodes?: number[]): Promise<RecordBatchReader> {
        const iterator = await this._inner.getInfo(infoCodes);
        return this._iteratorToReader(iterator as NativeAdbcStatementIterator);
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
    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }

    private async _iteratorToReader(iterator: NativeAdbcStatementIterator): Promise<RecordBatchReader> {
        const asyncIterable: AsyncIterable<Uint8Array> = {
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
        return RecordBatchReader.from(asyncIterable);
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
        // setSqlQuery is sync in native currently? 
        // Let's check lib.rs. "pub fn set_sql_query" returns Result<()>. It is SYNC.
        this._inner.setSqlQuery(query);
    }

    /**
     * Set an option on the statement.
     * @param key The option name.
     * @param value The option value.
     */
    setOption(key: string, value: string): void {
        // setOption is sync.
        this._inner.setOption(key, value);
    }

    /**
     * Execute the query and return a stream of results.
     * @returns A Promise resolving to an Apache Arrow RecordBatchReader.
     */
    async executeQuery(): Promise<RecordBatchReader> {
        // executeQuery IS async (returns AsyncTask)
        const iterator = await this._inner.executeQuery();
        
        // Reuse the logic from Connection? Or duplicate.
        // We need to handle the iterator type.
        const nativeIter = iterator as NativeAdbcStatementIterator;
        
        const asyncIterable: AsyncIterable<Uint8Array> = {
            [Symbol.asyncIterator]: async function* () {
                try {
                    while (true) {
                        const chunk = await nativeIter.next();
                        if (!chunk) {
                            break;
                        }
                        yield new Uint8Array(chunk as any);
                    }
                } finally {
                    nativeIter.close();
                }
            }
        };

        return RecordBatchReader.from(asyncIterable);
    }

    /**
     * Execute an update command (e.g., INSERT, UPDATE, DELETE) that returns no data.
     * @returns A Promise resolving to the number of rows affected.
     */
    async executeUpdate(): Promise<number | bigint> {
        // executeUpdate IS async
        const rows = await this._inner.executeUpdate();
        return rows as number;
    }

    /**
     * Bind parameters or data for ingestion.
     * @param data Arrow RecordBatch or Table containing the data to bind.
     */
    async bind(data: RecordBatch | Table): Promise<void> {
        let table: Table;
        if (data instanceof Table) {
            table = data;
        } else {
            table = new Table(data);
        }

        const ipcBytes = tableToIPC(table, "stream");
        // bind IS async
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
    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}