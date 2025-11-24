import { RecordBatchReader, Table, tableFromJSON } from 'apache-arrow';
import { AdbcDatabase, AdbcConnection as InternalAdbcConnection, AdbcStatement as InternalAdbcStatement } from './adbc';
import {
  BigQueryOptions,
  DuckDbOptions,
  FlightSqlOptions,
  PostgresOptions,
  SnowflakeOptions,
  SqliteOptions
} from './driver-options';

// Polyfill Symbol.asyncDispose if not present
// @ts-ignore
if (typeof Symbol.asyncDispose === 'undefined') {
  // @ts-ignore
  (Symbol as any).asyncDispose = Symbol('Symbol.asyncDispose');
}

// Registry for driver paths
const driverRegistry = new Map<string, string>();

export function registerDriver(name: string, path: string) {
  driverRegistry.set(name, path);
}

export function resolveDriver(name: string): string {
  if (driverRegistry.has(name)) {
    return driverRegistry.get(name)!;
  }
  return name;
}

export class Cursor implements AsyncDisposable {
  private statement: InternalAdbcStatement;
  private queryResult: { schema: bigint, stream: RecordBatchReader, rowsAffected: bigint } | null = null;

  constructor(statement: InternalAdbcStatement) {
    this.statement = statement;
  }

  async execute(query: string): Promise<void> {
    await this.statement.setSqlQuery(query);
    this.queryResult = await this.statement.executeQuery();
  }

  async fetchArrowTable(): Promise<Table> {
    if (!this.queryResult) {
      throw new Error("No query executed.");
    }

    const rows: any[] = [];
    for await (const batch of this.queryResult.stream) {
      rows.push(...batch.toArray());
    }
    return tableFromJSON(rows);
  }

  async close(): Promise<void> {
    if (this.queryResult) {
      this.queryResult.stream.cancel();
      this.queryResult = null;
    }
    await this.statement.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export class Connection implements AsyncDisposable {
  private database: AdbcDatabase;
  private connection: InternalAdbcConnection;

  constructor(database: AdbcDatabase, connection: InternalAdbcConnection) {
    this.database = database;
    this.connection = connection;
  }

  async cursor(): Promise<Cursor> {
    const stmt = await this.connection.createStatement();
    return new Cursor(stmt);
  }

  async close(): Promise<void> {
    await this.connection.close();
    await this.database.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// Function overloads for type safety
export async function connect(driver: 'sqlite', options: SqliteOptions): Promise<Connection>;
export async function connect(driver: 'postgresql', options: PostgresOptions): Promise<Connection>;
export async function connect(driver: 'duckdb', options: DuckDbOptions): Promise<Connection>;
export async function connect(driver: 'snowflake', options: SnowflakeOptions): Promise<Connection>;
export async function connect(driver: 'flightsql', options: FlightSqlOptions): Promise<Connection>;
export async function connect(driver: 'bigquery', options: BigQueryOptions): Promise<Connection>;
export async function connect(driver: string, options: Record<string, any>): Promise<Connection>;
export async function connect(driver: string, options: Record<string, any> = {}): Promise<Connection> {
  const driverPath = resolveDriver(driver);
  
  const dbOptions: Record<string, string> = {};
  // Convert all options to strings for the C API
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== null) {
        dbOptions[key] = String(value);
    }
  }

  const db = new AdbcDatabase(driverPath, undefined, dbOptions);
  const conn = await db.connect();
  
  return new Connection(db, conn);
}
