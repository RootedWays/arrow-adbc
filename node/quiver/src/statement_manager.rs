use adbc_driver_manager::ManagedStatement;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Clone)]
pub struct StatementEntry {
    pub id: String,
    pub statement: Arc<ManagedStatement>,
}

pub struct StatementRegistry {
    statements: RwLock<HashMap<String, StatementEntry>>,
}

impl StatementRegistry {
    pub fn new() -> Self {
        Self {
            statements: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, statement: ManagedStatement) -> String {
        let id = Uuid::new_v4().to_string();
        let entry = StatementEntry {
            id: id.clone(),
            statement: Arc::new(statement),
        };

        let mut stmt_map = self.statements.write().await;
        stmt_map.insert(id.clone(), entry);
        id
    }

    pub async fn get(&self, id: &str) -> Option<Arc<ManagedStatement>> {
        let stmt_map = self.statements.read().await;
        stmt_map.get(id).map(|entry| entry.statement.clone())
    }

    pub async fn remove(&self, id: &str) -> Option<StatementEntry> {
        let mut stmt_map = self.statements.write().await;
        stmt_map.remove(id)
    }
}
