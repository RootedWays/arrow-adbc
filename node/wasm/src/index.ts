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

import type { 
    AdbcDatabase as AdbcDatabaseInterface, 
    AdbcConnection as AdbcConnectionInterface, 
    AdbcStatement as AdbcStatementInterface, 
    ConnectOptions, 
    QueryOptions,
    GetObjectsOptions
} from 'adbc-shared';

import { AdbcInfoCode } from 'adbc-shared';
import { RecordBatchReader, RecordBatch, Table, Schema } from 'apache-arrow';

// Re-export types
export type { ConnectOptions, QueryOptions, GetObjectsOptions };
export { AdbcInfoCode };

// Safely get Symbol.asyncDispose
const asyncDisposeSymbol = (Symbol as any).asyncDispose ?? Symbol('Symbol.asyncDispose');

// --- Internal Driver Interface ---
interface AdbcDriver {
    connect(): Promise<AdbcConnectionInterface>;
    close(): Promise<void>;
}

// --- HTTP Driver Implementation ---

class HttpDriver implements AdbcDriver {
    private _url: string;

    constructor(url: string) {
        this._url = url;
    }

    async connect(): Promise<AdbcConnectionInterface> {
        return new HttpConnection(this._url);
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }
}

class HttpConnection implements AdbcConnectionInterface {
    private _url: string;

    constructor(url: string) {
        this._url = url;
    }

    async createStatement(): Promise<AdbcStatementInterface> {
        return new HttpStatement(this._url);
    }

    setOption(key: string, value: string): void {}
    setAutoCommit(enabled: boolean): void {}
    setReadOnly(enabled: boolean): void {}

    async getObjects(options?: GetObjectsOptions): Promise<RecordBatchReader> {
        throw new Error("Metadata not implemented for HTTP driver");
    }

    async getTableSchema(options: { catalog?: string; dbSchema?: string; tableName: string }): Promise<Schema> {
        throw new Error("Metadata not implemented for HTTP driver");
    }

    async getTableTypes(): Promise<RecordBatchReader> {
        throw new Error("Metadata not implemented for HTTP driver");
    }

    async getInfo(infoCodes?: number[]): Promise<RecordBatchReader> {
        throw new Error("Metadata not implemented for HTTP driver");
    }

    async commit(): Promise<void> {}
    async rollback(): Promise<void> {}
    
    async close(): Promise<void> {
        return Promise.resolve();
    }

    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}

class HttpStatement implements AdbcStatementInterface {
    private _url: string;
    private _query: string = "";

    constructor(url: string) {
        this._url = url;
    }

    async setSqlQuery(query: string): Promise<void> {
        this._query = query;
    }

    setOption(key: string, value: string): void {}

    async executeQuery(): Promise<RecordBatchReader> {
        if (!this._query) throw new Error("Query not set");

        const response = await fetch(this._url + "/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: this._query })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error("No response body");
        }

        return RecordBatchReader.from(response.body);
    }

    async executeUpdate(): Promise<number | bigint> {
        const reader = await this.executeQuery();
        for await (const _ of reader) {} 
        return 0; 
    }

    async bind(data: RecordBatch | Table): Promise<void> {
        throw new Error("Bind not implemented for HTTP driver");
    }

    async close(): Promise<void> {
        return Promise.resolve();
    }

    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}

// --- Driver Manager (Public API) ---

/**
 * ADBC Database Manager for WASM.
 * Delegates to specific driver implementations based on options.
 */
export class AdbcDatabase implements AdbcDatabaseInterface {
    private _driver: AdbcDriver;

    constructor(options: ConnectOptions) {
        if (options.driver === "http" || options.driver.startsWith("http")) {
            const url = options.driver.startsWith("http") ? options.driver : "http://localhost:8080";
            this._driver = new HttpDriver(url);
        } else {
            throw new Error(`Unknown or unsupported driver: ${options.driver}. (Only 'http' is supported in WASM currently)`);
        }
    }

    async connect(): Promise<AdbcConnectionInterface> {
        return this._driver.connect();
    }

    async close(): Promise<void> {
        return this._driver.close();
    }

    async [asyncDisposeSymbol](): Promise<void> {
        return this.close();
    }
}