use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::{delete, get, post},
    Extension, Router,
};
use serde_json::Value;
use std::sync::Arc;
use tower::util::ServiceExt;

use crate::{
    bind_statement, cancel_connection, commit_connection, connection_manager::ConnectionRegistry,
    create_connection, create_database, create_statement, database_manager::DatabaseRegistry,
    delete_connection as delete_connection_handler, delete_database as delete_database_handler,
    delete_statement as delete_statement_handler, driver_manager::DriverRegistry,
    execute_statement_query, execute_statement_update, get_connection_info, get_connection_objects,
    get_connection_table_schema, get_connection_table_types, get_database, health_check,
    list_databases, list_drivers, prepare_statement, query_connection_ipc, query_database_ipc,
    rollback_connection, set_connection_option, set_statement_option, set_statement_sql_query,
    statement_manager::StatementRegistry, AppState,
};

pub async fn app() -> Router {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "off".into()),
        )
        .try_init();

    let driver_registry = DriverRegistry::new().expect("Failed to initialize driver registry");

    let database_registry = DatabaseRegistry::new();

    let connection_registry = ConnectionRegistry::new();

    let statement_registry = StatementRegistry::new();

    let state = Arc::new(AppState {
        driver_registry: Arc::new(driver_registry),

        database_registry: Arc::new(database_registry),

        connection_registry: Arc::new(connection_registry),

        statement_registry: Arc::new(statement_registry),
    });

    Router::new()
        .route("/health", get(health_check))
        .route("/drivers", get(list_drivers))
        .route("/databases", get(list_databases).post(create_database))
        .route(
            "/databases/:id",
            get(get_database).delete(delete_database_handler),
        )
        .route("/databases/:id/connections", post(create_connection))
        .route("/databases/:id/query", post(query_database_ipc))
        .route("/connections", delete(delete_connection_handler))
        .route("/connections/commit", post(commit_connection))
        .route("/connections/rollback", post(rollback_connection))
        .route("/connections/cancel", post(cancel_connection))
        .route("/connections/query", post(query_connection_ipc))
        .route("/connections/options", post(set_connection_option))
        .route("/connections/info", get(get_connection_info))
        .route("/connections/objects", get(get_connection_objects))
        .route("/connections/table-types", get(get_connection_table_types))
        .route(
            "/connections/tables/:table_name/schema",
            get(get_connection_table_schema),
        )
        .route("/connections/statements", post(create_statement))
        .route("/statements", delete(delete_statement_handler))
        .route("/statements/sql", post(set_statement_sql_query))
        .route("/statements/bind", post(bind_statement))
        .route("/statements/options", post(set_statement_option))
        .route("/statements/prepare", post(prepare_statement))
        .route("/statements/execute", post(execute_statement_query))
        .route("/statements/execute_update", post(execute_statement_update))
        .layer(Extension(state))
}

pub async fn create_test_db(app: &Router) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "driver": "sqlite", "options": { "uri": ":memory:" } }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

pub async fn create_test_conn(app: &Router, db_id: &str) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/databases/{}/connections", db_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice::<Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

pub async fn create_test_stmt(app: &Router, conn_token: &str) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/statements")
                .header("Authorization", format!("Bearer {}", conn_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice::<Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

pub async fn exec_update(app: &Router, stmt_token: &str, sql: &str) {
    // Set SQL
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/sql")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/json")
                .body(Body::from(format!(r#"{{ "query": "{}" }}"#, sql)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Execute
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/execute_update")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

pub async fn delete_database(app: &Router, id: &str) {
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!("/databases/{}", id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
}

pub async fn delete_connection(app: &Router, token: &str) {
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/connections")
                .header("Authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
}

pub async fn delete_statement(app: &Router, token: &str) {
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/statements")
                .header("Authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
}
