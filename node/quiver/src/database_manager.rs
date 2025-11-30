use adbc_core::Database;
use adbc_driver_manager::{ManagedConnection, ManagedDatabase};
use deadpool::managed::{Manager, Object, Pool, RecycleResult};
use serde::Serialize;
use std::{
    collections::HashMap,
    ops::{Deref, DerefMut},
    sync::Arc,
};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

// --- Pooling Infrastructure ---

pub struct QuiverConnection(pub ManagedConnection);

// SAFETY: ADBC connections are generally movable. We assume the underlying
// driver implementation is thread-safe enough to allow the connection handle
// to be moved between threads when not in use.
unsafe impl Send for QuiverConnection {}
unsafe impl Sync for QuiverConnection {}

impl Deref for QuiverConnection {
    type Target = ManagedConnection;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for QuiverConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

pub struct AdbcConnectionManager {
    // Use Mutex to ensure Sync, as ManagedDatabase might not be Sync
    database: Arc<Mutex<ManagedDatabase>>,
}

impl AdbcConnectionManager {
    pub fn new(database: Arc<Mutex<ManagedDatabase>>) -> Self {
        Self { database }
    }
}

impl Manager for AdbcConnectionManager {
    type Type = QuiverConnection;
    type Error = adbc_core::error::Error;

    async fn create(&self) -> Result<QuiverConnection, Self::Error> {
        let db = self.database.lock().await;
        let conn = db.new_connection()?;
        // TODO: Verify if init is needed or implied.
        // Connection::init(&mut conn)?;
        Ok(QuiverConnection(conn))
    }

    async fn recycle(
        &self,
        _conn: &mut QuiverConnection,
        _metrics: &deadpool::managed::Metrics,
    ) -> RecycleResult<Self::Error> {
        Ok(())
    }
}

pub type AdbcConnectionPool = Pool<AdbcConnectionManager>;
pub type AdbcConnectionObject = Object<AdbcConnectionManager>;

// --- Registry ---

#[derive(Clone)]
pub struct DatabaseEntry {
    pub id: String,
    pub driver_name: String,
    // Store protected database
    pub _database: Arc<Mutex<ManagedDatabase>>,
    pub pool: AdbcConnectionPool,
}

impl DatabaseEntry {
    pub async fn acquire_connection(
        &self,
    ) -> Result<AdbcConnectionObject, adbc_core::error::Error> {
        self.pool.get().await.map_err(|e| {
            adbc_core::error::Error::with_message_and_status(
                format!("Failed to acquire connection from pool: {}", e),
                adbc_core::error::Status::Internal,
            )
        })
    }
}

pub struct DatabaseRegistry {
    // Map of ID -> DatabaseEntry
    // RwLock for concurrent access
    databases: RwLock<HashMap<String, DatabaseEntry>>,
}

impl DatabaseRegistry {
    pub fn new() -> Self {
        Self {
            databases: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, driver_name: String, database: ManagedDatabase) -> String {
        let id = Uuid::new_v4().to_string();

        // Wrap database in Mutex for Manager
        let db_arc = Arc::new(Mutex::new(database));
        let manager = AdbcConnectionManager::new(db_arc.clone());

        let pool = Pool::builder(manager)
            .max_size(16) // Default max size
            .build()
            .expect("Failed to build connection pool");

        let entry = DatabaseEntry {
            id: id.clone(),
            driver_name,
            _database: db_arc,
            pool,
        };

        let mut db_map = self.databases.write().await;
        db_map.insert(id.clone(), entry);
        id
    }

    pub async fn get(&self, id: &str) -> Option<DatabaseEntry> {
        let db_map = self.databases.read().await;
        db_map.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Option<DatabaseEntry> {
        let mut db_map = self.databases.write().await;
        db_map.remove(id)
    }

    pub async fn list(&self) -> Vec<DatabaseInfo> {
        let db_map = self.databases.read().await;
        db_map
            .values()
            .map(|entry| DatabaseInfo {
                id: entry.id.clone(),
                driver_name: entry.driver_name.clone(),
            })
            .collect()
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct DatabaseInfo {
    pub id: String,
    pub driver_name: String,
}
