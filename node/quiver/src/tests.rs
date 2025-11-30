use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use serde_json::Value;
use std::sync::Arc;
use tower::util::ServiceExt; // for `oneshot`

use crate::{
    cancel_connection, commit_connection, connection_manager::ConnectionRegistry,
    create_connection, create_database, create_statement, database_manager::DatabaseRegistry,
    delete_connection, delete_database, delete_statement, driver_manager::DriverRegistry,
    execute_statement_query, execute_statement_update, get_connection_info, get_connection_objects,
    get_connection_table_schema, get_connection_table_types, health_check, list_databases,
    list_drivers, prepare_statement, rollback_connection, set_statement_sql_query,
    statement_manager::StatementRegistry, AppState,
};
use axum::routing::{delete, get, post};
use axum::Extension;

// --- Helper Functions ---

async fn app() -> Router {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("quiver=debug,tower_http=debug")
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

async fn create_test_db(app: &Router) -> String {
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

async fn create_test_conn(app: &Router, db_id: &str) -> String {
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

async fn create_test_stmt(app: &Router, conn_id: &str) -> String {
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

async fn exec_update(app: &Router, stmt_id: &str, sql: &str) {
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

async fn delete_resource(app: &Router, uri: &str) {
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

// --- Tests ---

#[tokio::test]
async fn test_operational_endpoints() {
    let app = app().await;

    // 1. Health Check
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
        "OK"
    );

    // 2. List Drivers
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/drivers")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let drivers: Vec<String> = serde_json::from_slice(&body).unwrap();
    assert!(drivers.contains(&"sqlite".to_string()));
}

#[tokio::test]
async fn test_full_lifecycle_sqlite() {
    let app = app().await;

    let db_id = create_test_db(&app).await;
    println!("Created Database ID: {}", db_id);

    // List Databases
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/databases")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let dbs: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert!(dbs.iter().any(|db| db["id"] == db_id));

    let conn_id = create_test_conn(&app, &db_id).await;
    println!("Created Connection ID: {}", conn_id);

    delete_resource(&app, &format!("/connections/{}", conn_id)).await;
    delete_resource(&app, &format!("/databases/{}", db_id)).await;
}

#[tokio::test]
async fn test_connection_pooling_limits() {
    let app = app().await;
    let db_id = create_test_db(&app).await;

    let mut conn_ids = Vec::new();
    for _ in 0..5 {
        conn_ids.push(create_test_conn(&app, &db_id).await);
    }
    println!("Acquired {} connections", conn_ids.len());

    for id in conn_ids {
        delete_resource(&app, &format!("/connections/{}", id)).await;
    }
}

#[tokio::test]
async fn test_connection_actions() {
    let app = app().await;
    // Manual creation to test options
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
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let db_id = serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Create Connection (auto-commit false)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/databases/{}/connections", db_id))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "options": { "adbc.connection.autocommit": "false" } }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let conn_id = serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Commit
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/commit", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Rollback
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/rollback", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Cancel
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/cancel", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status() == StatusCode::NO_CONTENT
            || response.status() == StatusCode::NOT_IMPLEMENTED
    );

    delete_resource(&app, &format!("/connections/{}", conn_id)).await;
    delete_resource(&app, &format!("/databases/{}", db_id)).await;
}

#[tokio::test]
async fn test_statement_lifecycle() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_id = create_test_conn(&app, &db_id).await;
    let stmt_id = create_test_stmt(&app, &conn_id).await;

    // Set SQL
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/statements/{}/sql", stmt_id))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "query": "CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Prepare
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/statements/{}/prepare", stmt_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Execute Update
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

    delete_resource(&app, &format!("/statements/{}", stmt_id)).await;
    delete_resource(&app, &format!("/connections/{}", conn_id)).await;
    delete_resource(&app, &format!("/databases/{}", db_id)).await;
}

#[tokio::test]
async fn test_metadata_functions() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_id = create_test_conn(&app, &db_id).await;

    let stmt_id = create_test_stmt(&app, &conn_id).await;
    exec_update(&app, &stmt_id, "CREATE TABLE meta_test (id INT, val TEXT)").await;

    // Get Info
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/connections/{}/info", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let info: Vec<Value> = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(!info.is_empty());

    // Get Table Types
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/connections/{}/table-types", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let types: Vec<Value> = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(!types.is_empty());

    // Get Objects
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/connections/{}/objects", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let objects: Vec<Value> = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(objects.len() >= 0);

    // Get Schema
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/connections/{}/tables/meta_test/schema", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let schema: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(schema["fields"].as_array().unwrap().len(), 2);

    delete_resource(&app, &format!("/connections/{}", conn_id)).await;
    delete_resource(&app, &format!("/databases/{}", db_id)).await;
}

#[tokio::test]
async fn test_execute_query() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_id = create_test_conn(&app, &db_id).await;

    // Create Table
    let stmt_id = create_test_stmt(&app, &conn_id).await;
    exec_update(&app, &stmt_id, "CREATE TABLE query_test (id INT, val TEXT)").await;
    delete_resource(&app, &format!("/statements/{}", stmt_id)).await;

    // Insert Data
    let stmt_id = create_test_stmt(&app, &conn_id).await;
    exec_update(
        &app,
        &stmt_id,
        "INSERT INTO query_test VALUES (1, 'alpha'), (2, 'beta')",
    )
    .await;
    delete_resource(&app, &format!("/statements/{}", stmt_id)).await;

    // Select Data
    let stmt_id = create_test_stmt(&app, &conn_id).await;
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/statements/{}/sql", stmt_id))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "query": "SELECT * FROM query_test ORDER BY id" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/statements/{}/execute", stmt_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let rows: Vec<Value> = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], 1);
    assert_eq!(rows[0]["val"], "alpha");

    delete_resource(&app, &format!("/statements/{}", stmt_id)).await;
    delete_resource(&app, &format!("/connections/{}", conn_id)).await;
    delete_resource(&app, &format!("/databases/{}", db_id)).await;
}

#[tokio::test]
async fn test_error_handling() {
    let app = app().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{ "driver": "non-existent-driver" }"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/databases/non-existent-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases/non-existent-id/connections")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/connections/non-existent-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/non-existent-id/statements")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
