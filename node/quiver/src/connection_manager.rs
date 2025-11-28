use std::{
    collections::HashMap,
    sync::Arc,
};
use tokio::sync::{RwLock, Mutex};
use uuid::Uuid;
use crate::database_manager::AdbcConnectionObject;

pub struct ConnectionEntry {
    pub id: String,
    // Holds the pooled object. When this Entry is dropped (e.g. on remove),
    // the Object is dropped, returning the connection to the pool.
    pub connection: Mutex<AdbcConnectionObject>, // Wrapped in Mutex for interior mutability
}

pub struct ConnectionRegistry {
    connections: RwLock<HashMap<String, Arc<ConnectionEntry>>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, connection: AdbcConnectionObject) -> String {
        let id = Uuid::new_v4().to_string();
        let entry = Arc::new(ConnectionEntry {
            id: id.clone(),
            connection: Mutex::new(connection), // Wrap in Mutex here
        });
        
        let mut conn_map = self.connections.write().await;
        conn_map.insert(id.clone(), entry);
        id
    }

    pub async fn get(&self, id: &str) -> Option<Arc<ConnectionEntry>> {
        let conn_map = self.connections.read().await;
        conn_map.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Option<Arc<ConnectionEntry>> {
        let mut conn_map = self.connections.write().await;
        conn_map.remove(id)
    }
}
