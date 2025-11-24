/**
 * Options for the SQLite driver.
 */
export interface SqliteOptions {
  /**
   * The URI to connect to.
   * For SQLite, this can be a file path or ':memory:'.
   */
  uri: string;
  [key: string]: any;
}

/**
 * Options for the PostgreSQL driver.
 */
export interface PostgresOptions {
  /**
   * The connection URI.
   * e.g. "postgresql://user:pass@localhost:5432/dbname"
   */
  uri: string;
  [key: string]: any;
}

/**
 * Options for the DuckDB driver.
 */
export interface DuckDbOptions {
    /**
     * The path to the database file or ':memory:'.
     */
    path?: string;
    /**
     * The entrypoint for the driver init function if different from default.
     */
    entrypoint?: string;
    [key: string]: any;
}

/**
 * Options for the Snowflake driver.
 */
export interface SnowflakeOptions {
    uri: string;
    [key: string]: any;
}

/**
 * Options for the Flight SQL driver.
 */
export interface FlightSqlOptions {
    uri: string;
    [key: string]: any;
}

/**
 * Options for the BigQuery driver.
 */
export interface BigQueryOptions {
    [key: string]: any;
}
