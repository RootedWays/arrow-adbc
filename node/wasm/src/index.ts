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
  GetObjectsOptions,
} from 'adbc-shared'

import { AdbcInfoCode } from 'adbc-shared'
import { RecordBatchReader, RecordBatch, Table, Schema, tableFromIPC, tableToIPC } from 'apache-arrow'

// Re-export types
export type { ConnectOptions, QueryOptions, GetObjectsOptions }
export { AdbcInfoCode }

// Safely get Symbol.asyncDispose
const asyncDisposeSymbol = (Symbol as any).asyncDispose ?? Symbol('Symbol.asyncDispose')

// --- Internal Interfaces ---

interface DatabaseResponse {
  id: string
}

interface ConnectionResponse {
  token: string
}

interface StatementResponse {
  token: string
}

// --- HTTP Driver Implementation ---

class HttpDatabase implements AdbcDatabaseInterface {
  private _url: string
  private _options: ConnectOptions
  private _dbId: string | null = null
  private _initPromise: Promise<string> | null = null

  constructor(url: string, options: ConnectOptions) {
    this._url = url
    this._options = options
  }

  private async _initDatabase(): Promise<string> {
    if (this._dbId) return this._dbId

    const dbOptions = this._options.databaseOptions || {}
    const backendDriver = dbOptions['backend_driver'] || 'sqlite'

    const { backend_driver, ...restOptions } = dbOptions

    // Filter out connection-specific options (starting with "adbc.connection.")
    // so they don't cause errors when creating the database.
    const dbCreationOptions: Record<string, string> = {}
    for (const [key, value] of Object.entries(restOptions)) {
      if (!key.startsWith('adbc.connection.')) {
        dbCreationOptions[key] = value
      }
    }

    const response = await fetch(`${this._url}/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driver: backendDriver,
        options: dbCreationOptions,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create database: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as DatabaseResponse
    this._dbId = data.id
    return data.id
  }

  async connect(): Promise<AdbcConnectionInterface> {
    if (!this._initPromise) {
      this._initPromise = this._initDatabase()
    }
    const dbId = await this._initPromise

    // Filter out database-specific options that shouldn't be passed to connection
    const { backend_driver, uri, ...connOptions } = this._options.databaseOptions || {}

    const response = await fetch(`${this._url}/databases/${dbId}/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: connOptions,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create connection: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ConnectionResponse
    return new HttpConnection(this._url, data.token)
  }

  async close(): Promise<void> {
    // Ideally we should delete the database on the server if we own it.
    // But AdbcDatabase.close() usually just releases the handle.
    // If we want to be clean, we can call DELETE /databases/{id}
    if (this._dbId) {
      await fetch(`${this._url}/databases/${this._dbId}`, {
        method: 'DELETE',
      })
      this._dbId = null
    }
  }

  async [asyncDisposeSymbol](): Promise<void> {
    return this.close()
  }
}

class HttpConnection implements AdbcConnectionInterface {
  private _url: string
  private _token: string

  constructor(url: string, token: string) {
    this._url = url
    this._token = token
  }

  private _authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this._token}`,
      'Content-Type': 'application/json',
    }
  }

  async createStatement(): Promise<AdbcStatementInterface> {
    const response = await fetch(`${this._url}/connections/statements`, {
      method: 'POST',
      headers: this._authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Failed to create statement: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as StatementResponse
    return new HttpStatement(this._url, data.token)
  }

  async setOption(key: string, value: string): Promise<void> {
    const response = await fetch(`${this._url}/connections/options`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify({ key, value }),
    })

    if (!response.ok) {
      throw new Error(`setOption failed: ${response.status} ${response.statusText}`)
    }
  }

  async setAutoCommit(enabled: boolean): Promise<void> {
    return this.setOption('adbc.connection.autocommit', enabled ? 'true' : 'false')
  }

  async setReadOnly(enabled: boolean): Promise<void> {
    return this.setOption('adbc.connection.readonly', enabled ? 'true' : 'false')
  }

  async getObjects(options?: GetObjectsOptions): Promise<RecordBatchReader> {
    const params = new URLSearchParams()
    if (options?.depth !== undefined) params.set('depth', options.depth.toString())
    if (options?.catalog) params.set('catalog', options.catalog)
    if (options?.dbSchema) params.set('db_schema', options.dbSchema)
    if (options?.tableName) params.set('table_name', options.tableName)
    if (options?.tableType) options.tableType.forEach((t: string) => params.append('table_type', t))
    if (options?.columnName) params.set('column_name', options.columnName)

    const response = await fetch(`${this._url}/connections/objects?${params.toString()}`, {
      headers: this._authHeaders(),
    })

    if (!response.ok) throw new Error(`getObjects failed: ${response.status} ${response.statusText}`)
    if (!response.body) throw new Error('No response body')

    return RecordBatchReader.from(response.body)
  }

  async getTableSchema(options: { catalog?: string; dbSchema?: string; tableName: string }): Promise<Schema> {
    const params = new URLSearchParams()
    if (options.catalog) params.set('catalog', options.catalog)
    if (options.dbSchema) params.set('db_schema', options.dbSchema)

    const response = await fetch(`${this._url}/connections/tables/${options.tableName}/schema?${params.toString()}`, {
      headers: this._authHeaders(),
    })

    if (!response.ok) throw new Error(`getTableSchema failed: ${response.status} ${response.statusText}`)

    const buffer = await response.arrayBuffer()
    const table = tableFromIPC(new Uint8Array(buffer))
    return table.schema
  }

  async getTableTypes(): Promise<RecordBatchReader> {
    const response = await fetch(`${this._url}/connections/table-types`, {
      headers: this._authHeaders(),
    })

    if (!response.ok) throw new Error(`getTableTypes failed: ${response.status} ${response.statusText}`)
    if (!response.body) throw new Error('No response body')
    return RecordBatchReader.from(response.body)
  }

  async getInfo(infoCodes?: number[]): Promise<RecordBatchReader> {
    // Query params? Spec says GET /connections/info
    // It doesn't show parameters in the summary I saw.
    // But usually infoCodes are filtered client side or server side.
    const response = await fetch(`${this._url}/connections/info`, {
      headers: this._authHeaders(),
    })

    if (!response.ok) throw new Error(`getInfo failed: ${response.status} ${response.statusText}`)
    if (!response.body) throw new Error('No response body')
    return RecordBatchReader.from(response.body)
  }

  async commit(): Promise<void> {
    const response = await fetch(`${this._url}/connections/commit`, {
      method: 'POST',
      headers: this._authHeaders(),
    })
    if (!response.ok) throw new Error(`commit failed: ${response.status}`)
  }

  async rollback(): Promise<void> {
    const response = await fetch(`${this._url}/connections/rollback`, {
      method: 'POST',
      headers: this._authHeaders(),
    })
    if (!response.ok) throw new Error(`rollback failed: ${response.status}`)
  }

  async close(): Promise<void> {
    // DELETE /connections is the endpoint in the spec?
    // /connections DELETE -> release connection
    await fetch(`${this._url}/connections`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    })
  }

  async [asyncDisposeSymbol](): Promise<void> {
    return this.close()
  }
}

class HttpStatement implements AdbcStatementInterface {
  private _url: string
  private _token: string

  constructor(url: string, token: string) {
    this._url = url
    this._token = token
  }

  private _authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this._token}`,
      'Content-Type': 'application/json',
    }
  }

  async setSqlQuery(query: string): Promise<void> {
    const response = await fetch(`${this._url}/statements/sql`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      throw new Error(`setSqlQuery failed: ${response.status} ${response.statusText}`)
    }
  }

  async setOption(key: string, value: string): Promise<void> {
    const response = await fetch(`${this._url}/statements/options`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify({ key, value }),
    })

    if (!response.ok) {
      throw new Error(`setOption failed: ${response.status} ${response.statusText}`)
    }
  }

  async executeQuery(): Promise<RecordBatchReader> {
    const response = await fetch(`${this._url}/statements/execute`, {
      method: 'POST',
      headers: this._authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`executeQuery failed: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    return RecordBatchReader.from(response.body)
  }

  async executeUpdate(): Promise<number | bigint> {
    const response = await fetch(`${this._url}/statements/execute_update`, {
      method: 'POST',
      headers: this._authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`executeUpdate failed: ${response.status} ${response.statusText}`)
    }

    // Rows affected is unknown (-1) for now
    return -1
  }

  async bind(data: RecordBatch | Table): Promise<void> {
    // Serialize Arrow data to IPC format
    const buffer = tableToIPC(data);

    const response = await fetch(`${this._url}/statements/bind`, {
        method: 'POST',
        headers: {
            ...this._authHeaders(),
            'Content-Type': 'application/octet-stream'
        } as HeadersInit,
        body: buffer
    });

    if (!response.ok) {
        throw new Error(`bind failed: ${response.status} ${response.statusText}`);
    }
  }

  async close(): Promise<void> {
    await fetch(`${this._url}/statements`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    })
  }

  async [asyncDisposeSymbol](): Promise<void> {
    return this.close()
  }
}

// --- Driver Manager (Public API) ---

/**
 * ADBC Database Manager for WASM.
 * Delegates to specific driver implementations based on options.
 */
export class AdbcDatabase implements AdbcDatabaseInterface {
  private _driver: AdbcDatabaseInterface

  constructor(options: ConnectOptions) {
    if (options.driver === 'http' || options.driver.startsWith('http')) {
      // If driver is just "http", default to localhost:8080, otherwise use the string as URL
      const url = options.driver === 'http' ? 'http://localhost:8080' : options.driver
      this._driver = new HttpDatabase(url, options)
    } else {
      throw new Error(`Unknown or unsupported driver: ${options.driver}. (Only 'http' is supported in WASM currently)`)
    }
  }

  async connect(): Promise<AdbcConnectionInterface> {
    return this._driver.connect()
  }

  async close(): Promise<void> {
    return this._driver.close()
  }

  async [asyncDisposeSymbol](): Promise<void> {
    return this.close()
  }
}
