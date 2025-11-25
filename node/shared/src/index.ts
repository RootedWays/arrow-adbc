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

import { RecordBatch, RecordBatchReader, Table, Schema } from 'apache-arrow';

/** Options for connecting to a driver/database. */
export interface ConnectOptions {
  /** Path to the driver library or name of the driver. */
  driver: string;
  /** Name of the entrypoint function (optional). */
  entrypoint?: string;
  /** Paths to search for the driver (optional). */
  searchPaths?: string[];
  /** Load flags (optional). */
  loadFlags?: number;
  /** Database-specific options. */
  databaseOptions?: Record<string, string>;
}

/** Options for statement execution. */
export interface QueryOptions {
  /** Statement-specific options. */
  statementOptions?: Record<string, string>;
}

/** Options for getObjects metadata call. */
export interface GetObjectsOptions {
  depth?: number;
  catalog?: string;
  dbSchema?: string;
  tableName?: string;
  tableType?: string[];
  columnName?: string;
}

/**
 * Represents an ADBC Database.
 * Holds state shared across connections.
 */
export interface AdbcDatabase {
  /** Open a new connection to the database. */
  connect(): Promise<AdbcConnection>;
  
  /** Release the database resources. */
  close(): Promise<void>;
}

/**
 * Represents a single connection to a database.
 */
export interface AdbcConnection {
  /** Create a new statement for executing queries. */
  createStatement(): Promise<AdbcStatement>;
  
  /** Get a hierarchical view of database objects. */
  getObjects(options?: GetObjectsOptions): Promise<RecordBatchReader>;
  
  /** Get the Arrow schema for a specific table. */
  getTableSchema(catalog: string | null, dbSchema: string | null, tableName: string): Promise<Schema>;
  
  /** Get a list of table types supported by the database. */
  getTableTypes(): Promise<RecordBatchReader>;
  
  /** Get metadata about the driver and database. */
  getInfo(infoCodes?: number[]): Promise<RecordBatchReader>;

  /** Close the connection. */
  close(): Promise<void>;
}

/**
 * Represents a query statement.
 */
export interface AdbcStatement {
  /** Set the SQL query string. */
  setSqlQuery(query: string): Promise<void>;
  
  /** Set options on the statement. */
  setOption(key: string, value: string): Promise<void>;

  /** 
   * Execute the query and return a stream of results. 
   */
  executeQuery(): Promise<RecordBatchReader>;
  
  /** Execute an update (no results). */
  executeUpdate(): Promise<number | bigint>; // Rows affected

  /**
   * Bind parameters or data for ingestion.
   * @param data Arrow RecordBatch or Table containing the data to bind.
   */
  bind(data: RecordBatch | Table): Promise<void>;

  /** Close the statement. */
  close(): Promise<void>;
}