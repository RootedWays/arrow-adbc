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
    cancel_connection, commit_connection, connection_manager::ConnectionRegistry,
    create_connection, create_database, create_statement, database_manager::DatabaseRegistry,
    delete_connection, delete_database, delete_statement, driver_manager::DriverRegistry,
    execute_statement_query, execute_statement_update, get_connection_info, get_connection_objects,
    get_connection_table_schema, get_connection_table_types, health_check, list_databases,
    list_drivers, prepare_statement, rollback_connection, set_statement_sql_query,
    statement_manager::StatementRegistry, AppState,
};

pub async fn app() -> Router {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "off".into()),
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
        .route("/databases/:id", delete(delete_database))
        .route("/databases/:id/connections", post(create_connection))
        .route("/connections/:id", delete(delete_connection))
        .route("/connections/:id/commit", post(commit_connection))
        .route("/connections/:id/rollback", post(rollback_connection))
        .route("/connections/:id/cancel", post(cancel_connection))
        .route("/connections/:id/statements", post(create_statement))
        .route("/statements/:id", delete(delete_statement))
        .route("/statements/:id/sql", post(set_statement_sql_query))
        .route("/statements/:id/prepare", post(prepare_statement))
        .route("/statements/:id/execute", post(execute_statement_query))
        .route(
            "/statements/:id/execute_update",
            post(execute_statement_update),
        )
        .route("/connections/:id/info", get(get_connection_info))
        .route("/connections/:id/objects", get(get_connection_objects))
        .route(
            "/connections/:id/table-types",
            get(get_connection_table_types),
        )
        .route(
            "/connections/:id/tables/:table_name/schema",
            get(get_connection_table_schema),
        )
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
    serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

pub async fn create_test_stmt(app: &Router, conn_id: &str) -> String {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/statements", conn_id))
                .body(Body::empty())
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

pub async fn exec_update(app: &Router, stmt_id: &str, sql: &str) {
    // Set SQL
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/statements/{}/sql", stmt_id))
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
                .uri(&format!("/statements/{}/execute_update", stmt_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

pub async fn delete_resource(app: &Router, uri: &str) {
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
}
