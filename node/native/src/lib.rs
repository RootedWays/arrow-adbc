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

#![deny(clippy::all)]

use napi::{Error, Result, Status};
use napi_derive::napi;
use adbc_driver_manager::{ManagedConnection, ManagedDatabase, ManagedDriver, ManagedStatement};
use adbc_core::options::AdbcVersion;
use adbc_core::{Database, Connection, Statement, Driver};

#[napi]
pub struct AdbcDatabase {
  inner: ManagedDatabase,
}

#[napi]
impl AdbcDatabase {
  #[napi(constructor)]
  pub fn new(driver: String, entrypoint: Option<String>) -> Result<Self> {
    // Default to version 1.1.0 and standard search paths
    let version = AdbcVersion::V110;
    let load_flags = adbc_core::LOAD_FLAG_SEARCH_SYSTEM | adbc_core::LOAD_FLAG_SEARCH_USER;
    
    let mut driver = ManagedDriver::load_from_name(
        &driver,
        entrypoint.as_ref().map(|s| s.as_bytes()),
        version,
        load_flags,
        None
    ).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    let database = driver.new_database().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

    Ok(Self { inner: database })
  }

  #[napi]
  pub fn connection(&self) -> Result<AdbcConnection> {
      let connection = self.inner.new_connection().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
      Ok(AdbcConnection { inner: connection })
  }
}

#[napi]
pub struct AdbcConnection {
    inner: ManagedConnection,
}

#[napi]
impl AdbcConnection {
    #[napi]
    pub fn statement(&mut self) -> Result<AdbcStatement> {
        let statement = self.inner.new_statement().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(AdbcStatement { inner: statement })
    }
}

#[napi]
pub struct AdbcStatement {
    inner: ManagedStatement,
}

#[napi]
impl AdbcStatement {
    #[napi]
    pub fn set_sql_query(&mut self, query: String) -> Result<()> {
        self.inner.set_sql_query(&query).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    #[napi]
    pub fn execute(&mut self) -> Result<i64> {
        // TODO: This should return the arrow array stream pointer
        // For now, we just execute and drop the result to verify basic linking
        let _ = self.inner.execute().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(0) 
    }
}