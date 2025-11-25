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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use adbc_core::{
    options::{AdbcVersion, OptionConnection, OptionDatabase, OptionStatement, OptionValue},
    Connection, Database, Driver, LoadFlags, Statement, Optionable, LOAD_FLAG_DEFAULT,
};
use adbc_driver_manager::{ManagedConnection, ManagedDatabase, ManagedDriver, ManagedStatement};
use arrow_array::RecordBatchReader;
use arrow_ipc::writer::StreamWriter;

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("ADBC Error: {0}")]
    Adbc(#[from] adbc_core::error::Error),
    #[error("Arrow Error: {0}")]
    Arrow(#[from] arrow_schema::ArrowError),
    #[error("Other Error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ClientError>;

pub struct ConnectOptions {
    pub driver: String,
    pub entrypoint: Option<String>,
    pub search_paths: Option<Vec<String>>,
    pub load_flags: Option<u32>,
    pub database_options: Option<HashMap<String, String>>,
}

pub struct AdbcDatabase {
    inner: ManagedDatabase,
}

impl AdbcDatabase {
    pub fn new(opts: ConnectOptions) -> Result<Self> {
        let version = AdbcVersion::V110;
        let load_flags = opts.load_flags.unwrap_or(LOAD_FLAG_DEFAULT);
        let entrypoint = opts.entrypoint.as_ref().map(|s| s.as_bytes().to_vec());

        let search_paths: Option<Vec<PathBuf>> = opts
            .search_paths
            .map(|paths| paths.into_iter().map(PathBuf::from).collect());

        let mut driver = ManagedDriver::load_from_name(
            &opts.driver,
            entrypoint.as_deref(),
            version,
            load_flags,
            search_paths,
        )?;

        let database = if let Some(db_map) = opts.database_options {
            let db_opts = map_database_options(Some(db_map));
            driver.new_database_with_opts(db_opts)?
        } else {
            driver.new_database()?
        };

        Ok(Self { inner: database })
    }

    pub fn connect(&self, options: Option<HashMap<String, String>>) -> Result<AdbcConnection> {
        let conn = if let Some(opts) = options {
            self.inner.new_connection_with_opts(map_connection_options(opts))?
        } else {
            self.inner.new_connection()?
        };
        Ok(AdbcConnection { inner: Mutex::new(conn) })
    }
}

pub struct AdbcConnection {
    inner: Mutex<ManagedConnection>,
}

impl AdbcConnection {
    pub fn new_statement(&self) -> Result<AdbcStatement> {
        let mut conn = self.inner.lock().map_err(|e| ClientError::Other(e.to_string()))?;
        let stmt = conn.new_statement()?;
        Ok(AdbcStatement { inner: stmt })
    }
}

pub struct AdbcStatement {
    inner: ManagedStatement,
}

impl AdbcStatement {
    pub fn set_sql_query(&mut self, query: &str) -> Result<()> {
        self.inner.set_sql_query(query)?;
        Ok(())
    }

    pub fn set_option(&mut self, key: &str, value: &str) -> Result<()> {
        // Only string options supported for basic implementation
        self.inner.set_option(OptionStatement::Other(key.to_string()), OptionValue::String(value.to_string()))?;
        Ok(())
    }

    pub fn execute_query(&mut self) -> Result<AdbcStatementIterator> {
        let reader = self.inner.execute()?;
        
        // SAFETY: See previous explanation. 
        // We clone the statement (which is an Arc internally) to keep it alive in the iterator.
        let reader: Box<dyn RecordBatchReader + Send> = unsafe {
            std::mem::transmute(Box::new(reader) as Box<dyn RecordBatchReader + Send>)
        };

        Ok(AdbcStatementIterator {
            reader,
            _statement: self.inner.clone(),
            schema: None,
        })
    }
    
    pub fn execute_update(&mut self) -> Result<i64> {
        let rows = self.inner.execute_update()?;
        Ok(rows.unwrap_or(-1))
    }
}

pub struct AdbcStatementIterator {
    reader: Box<dyn RecordBatchReader + Send>,
    _statement: ManagedStatement,
    schema: Option<Arc<arrow_schema::Schema>>,
}

impl AdbcStatementIterator {
    pub fn next(&mut self) -> Result<Option<Vec<u8>>> {
        if self.schema.is_none() {
            self.schema = Some(self.reader.schema());
        }
        
        match self.reader.next() {
            Some(Ok(batch)) => {
                let mut output = Vec::new();
                let mut writer = StreamWriter::try_new(&mut output, self.schema.as_ref().unwrap())?;
                writer.write(&batch)?;
                writer.finish()?;
                Ok(Some(output))
            }
            Some(Err(e)) => Err(ClientError::Arrow(e)),
            None => Ok(None),
        }
    }
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