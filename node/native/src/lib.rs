use adbc_client::{AdbcConnection as CoreConnection, AdbcDatabase as CoreDatabase, AdbcStatement as CoreStatement, AdbcStatementIterator as CoreIterator, ConnectOptions as CoreConnectOptions};
use adbc_core::{options::AdbcVersion, LoadFlags, LOAD_FLAG_DEFAULT};
use adbc_driver_manager::ManagedDriver;
use napi::bindgen_prelude::{AsyncTask, Buffer, Error, Result};
use napi::Task;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[macro_use]
extern crate napi_derive;

fn to_napi_err<E: std::fmt::Display>(err: E) -> Error {
    Error::from_reason(err.to_string())
}

#[napi]
pub fn crate_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[napi]
pub fn default_adbc_version() -> String {
    match AdbcVersion::default() {
        AdbcVersion::V100 => "1.0.0".to_string(),
        AdbcVersion::V110 => "1.1.0".to_string(),
        _ => "unknown".to_string(),
    }
}

#[napi]
pub fn default_load_flags() -> u32 {
    let _ = std::any::type_name::<ManagedDriver>();
    LoadFlags::default()
}

// Options
#[napi(object)]
pub struct ConnectOptions {
    pub driver: String,
    pub entrypoint: Option<String>,
    pub search_paths: Option<Vec<String>>,
    pub load_flags: Option<u32>,
    pub database_options: Option<HashMap<String, String>>,
}

impl From<ConnectOptions> for CoreConnectOptions {
    fn from(opts: ConnectOptions) -> Self {
        Self {
            driver: opts.driver,
            entrypoint: opts.entrypoint,
            search_paths: opts.search_paths,
            load_flags: opts.load_flags,
            database_options: opts.database_options,
        }
    }
}

// Classes

#[napi]
pub struct _NativeAdbcDatabase {
    inner: Arc<CoreDatabase>,
}

#[napi]
impl _NativeAdbcDatabase {
    #[napi(constructor)]
    pub fn new(opts: ConnectOptions) -> Result<Self> {
        let db = CoreDatabase::new(opts.into()).map_err(to_napi_err)?;
        Ok(Self { inner: Arc::new(db) })
    }

    #[napi]
    pub fn connect(&self, options: Option<HashMap<String, String>>) -> Result<_NativeAdbcConnection> {
        let conn = self.inner.connect(options).map_err(to_napi_err)?;
        Ok(_NativeAdbcConnection { inner: Arc::new(conn) })
    }
}

#[napi]
pub struct _NativeAdbcConnection {
    inner: Arc<CoreConnection>,
}

#[napi]
impl _NativeAdbcConnection {
    #[napi]
    pub fn create_statement(&self) -> Result<_NativeAdbcStatement> {
        let stmt = self.inner.new_statement().map_err(to_napi_err)?;
        Ok(_NativeAdbcStatement { inner: Arc::new(Mutex::new(stmt)) })
    }
}

#[napi]
pub struct _NativeAdbcStatement {
    inner: Arc<Mutex<CoreStatement>>,
}

#[napi]
impl _NativeAdbcStatement {
    #[napi]
    pub fn set_sql_query(&self, query: String) -> Result<()> {
        let mut stmt = self.inner.lock().unwrap();
        stmt.set_sql_query(&query).map_err(to_napi_err)
    }

    #[napi]
    pub fn set_option(&self, key: String, value: String) -> Result<()> {
        let mut stmt = self.inner.lock().unwrap();
        stmt.set_option(&key, &value).map_err(to_napi_err)
    }

    #[napi]
    pub fn execute_query(&self) -> Result<_NativeAdbcStatementIterator> {
        let mut stmt = self.inner.lock().unwrap();
        let iterator = stmt.execute_query().map_err(to_napi_err)?;
        Ok(_NativeAdbcStatementIterator { inner: Arc::new(Mutex::new(iterator)) })
    }

    #[napi]
    pub fn execute_update(&self) -> Result<i64> {
        let mut stmt = self.inner.lock().unwrap();
        stmt.execute_update().map_err(to_napi_err)
    }
}

// Iterator Task
pub struct IteratorNextTask {
    iterator: Arc<Mutex<CoreIterator>>,
}

impl Task for IteratorNextTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut iterator = self.iterator.lock().map_err(|e| Error::from_reason(e.to_string()))?;
        iterator.next().map_err(to_napi_err)
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(Buffer::from))
    }
}

#[napi]
pub struct _NativeAdbcStatementIterator {
    inner: Arc<Mutex<CoreIterator>>,
}

#[napi]
impl _NativeAdbcStatementIterator {
    #[napi]
    pub fn next(&self) -> AsyncTask<IteratorNextTask> {
        AsyncTask::new(IteratorNextTask {
            iterator: self.inner.clone(),
        })
    }
}