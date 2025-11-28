use adbc_driver_manager::ManagedStatement;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{RwLock, Mutex};
use uuid::Uuid;

pub struct StatementEntry {
    pub id: String,
    pub statement: Mutex<ManagedStatement>,
}

pub struct StatementRegistry {
    statements: RwLock<HashMap<String, Arc<StatementEntry>>>,
}

impl StatementRegistry {
    pub fn new() -> Self {
        Self {
            statements: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, statement: ManagedStatement) -> String {
        let id = Uuid::new_v4().to_string();
        let entry = Arc::new(StatementEntry {
            id: id.clone(),
            statement: Mutex::new(statement),
        });

        let mut stmt_map = self.statements.write().await;
        stmt_map.insert(id.clone(), entry);
        id
    }

    pub async fn get(&self, id: &str) -> Option<Arc<StatementEntry>> {
        let stmt_map = self.statements.read().await;
        stmt_map.get(id).cloned()
    }

    pub async fn remove(&self, id: &str) -> Option<Arc<StatementEntry>> {
        let mut stmt_map = self.statements.write().await;
        stmt_map.remove(id)
    }
}