// Minimal napi-rs binding that leans on the Rust ADBC driver manager and Arrow IPC.

use std::sync::Arc;

use adbc_core::{
    options::{AdbcVersion, OptionConnection, OptionDatabase, OptionValue},
    Connection, Database, Driver, LoadFlags, Statement, LOAD_FLAG_DEFAULT,
};
use adbc_driver_manager::{ManagedConnection, ManagedDriver};
use arrow_array::{Int32Array, RecordBatch, RecordBatchReader};
use arrow_ipc::writer::StreamWriter;
use arrow_schema::{DataType, Field, Schema};
use napi::bindgen_prelude::{Buffer, Error, Result};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

#[macro_use]
extern crate napi_derive;

fn to_napi_err<E: std::fmt::Display>(err: E) -> Error {
    Error::from_reason(err.to_string())
}

/// Crate version baked into the native addon.
#[napi]
pub fn crate_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Returns the default ADBC protocol version the Rust driver manager targets.
#[napi]
pub fn default_adbc_version() -> String {
    match AdbcVersion::default() {
        AdbcVersion::V100 => "1.0.0".to_string(),
        AdbcVersion::V110 => "1.1.0".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Returns the default driver load flags as a bitmask (mainly to exercise the dependency).
#[napi]
pub fn default_load_flags() -> u32 {
    // Touch ManagedDriver so the crate stays in use even before we wire calls through.
    let _ = std::any::type_name::<ManagedDriver>();
    LoadFlags::default()
}

/// Options for connecting to a driver/database.
#[napi(object)]
pub struct ConnectOptions {
    pub driver: String,
    pub entrypoint: Option<String>,
    pub search_paths: Option<Vec<String>>,
    pub load_flags: Option<u32>,
    pub database_options: Option<HashMap<String, String>>,
    pub connection_options: Option<HashMap<String, String>>,
}

#[napi(object)]
pub struct QueryOptions {
    pub statement_options: Option<HashMap<String, String>>,
}

#[napi]
pub struct ClientHandle {
    connection: Mutex<ManagedConnection>,
}

#[napi]
impl ClientHandle {
    /// Execute a SQL query and return an Arrow IPC stream as a Buffer.
    #[napi]
    pub fn query(&self, sql: String, _opts: Option<QueryOptions>) -> Result<Buffer> {
        let mut connection = self.connection.lock().unwrap();
        let mut statement = connection.new_statement().map_err(to_napi_err)?;
        statement.set_sql_query(sql).map_err(to_napi_err)?;

        let mut reader = statement.execute().map_err(to_napi_err)?;
        write_stream_to_ipc(&mut reader)
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        // ManagedConnection drops cleanly; nothing to do yet.
        Ok(())
    }
}

#[napi]
pub fn connect(opts: ConnectOptions) -> Result<ClientHandle> {
    // Use V100 for widest driver compatibility (SQLite driver is V100-oriented).
    let version = AdbcVersion::V100;
    let load_flags = opts
        .load_flags
        .unwrap_or_else(|| LOAD_FLAG_DEFAULT);
    let entrypoint = opts.entrypoint.as_ref().map(|s| s.as_bytes().to_vec());

    let search_paths: Option<Vec<PathBuf>> = opts
        .search_paths
        .map(|paths| paths.into_iter().map(PathBuf::from).collect());

    let mut driver = ManagedDriver::load_from_name(
        &opts.driver,
        entrypoint.as_deref(),
        version,
        load_flags,
        search_paths.clone(),
    )
    .map_err(to_napi_err)?;

    let database = if let Some(db_map) = opts.database_options.clone() {
        let db_opts = map_database_options(Some(db_map));
        driver
            .new_database_with_opts(db_opts)
            .map_err(to_napi_err)?
    } else {
        driver.new_database().map_err(to_napi_err)?
    };

    let conn = if let Some(conn_opts) = opts.connection_options {
        database
            .new_connection_with_opts(map_connection_options(conn_opts))
            .map_err(to_napi_err)?
    } else {
        database.new_connection().map_err(to_napi_err)?
    };

    // Keep the connection alive in the client handle.
    Ok(ClientHandle {
        connection: Mutex::new(conn.clone()),
    })
}

fn map_database_options(
    opts: Option<HashMap<String, String>>,
) -> impl Iterator<Item = (OptionDatabase, OptionValue)> {
    opts.into_iter().flatten().map(|(k, v)| {
        let key = match k.as_str() {
            "uri" | "URI" => OptionDatabase::Uri,
            "username" | "user" => OptionDatabase::Username,
            "password" | "pwd" => OptionDatabase::Password,
            other => OptionDatabase::Other(other.to_string()),
        };
        (key, OptionValue::String(v))
    })
}

fn map_connection_options(
    opts: HashMap<String, String>,
) -> impl Iterator<Item = (OptionConnection, OptionValue)> {
    opts.into_iter().map(|(k, v)| {
        let key = match k.as_str() {
            "autocommit" => OptionConnection::AutoCommit,
            "readonly" | "readOnly" => OptionConnection::ReadOnly,
            "currentCatalog" | "catalog" => OptionConnection::CurrentCatalog,
            "currentSchema" | "schema" => OptionConnection::CurrentSchema,
            "isolationLevel" => OptionConnection::IsolationLevel,
            other => OptionConnection::Other(other.to_string()),
        };
        (key, OptionValue::String(v))
    })
}

fn write_stream_to_ipc(reader: &mut dyn RecordBatchReader) -> Result<Buffer> {
    let schema = reader.schema();
    let mut output = Vec::new();
    {
        let mut writer = StreamWriter::try_new(&mut output, &schema).map_err(to_napi_err)?;
        for batch in reader {
            let batch = batch.map_err(to_napi_err)?;
            writer.write(&batch).map_err(to_napi_err)?;
        }
        writer.finish().map_err(to_napi_err)?;
    }
    Ok(Buffer::from(output))
}

/// Produce a tiny Arrow IPC stream (one Int32 column) for plumbing tests.
#[napi]
pub fn sample_ipc_stream() -> Result<Buffer> {
    let field = Field::new("value", DataType::Int32, true);
    let schema = Arc::new(Schema::new(vec![field]));
    let data = Int32Array::from(vec![Some(1), None, Some(3)]);
    let batch =
        RecordBatch::try_new(schema.clone(), vec![Arc::new(data)]).map_err(to_napi_err)?;

    let mut output = Vec::new();
    {
        let mut writer = StreamWriter::try_new(&mut output, &schema).map_err(to_napi_err)?;
        writer.write(&batch).map_err(to_napi_err)?;
        writer.finish().map_err(to_napi_err)?;
    }

    Ok(Buffer::from(output))
}
