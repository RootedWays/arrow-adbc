use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use serde_json::Value;
use std::sync::Arc;
use tower::util::ServiceExt; // for `oneshot`

use crate::{
    connection_manager::ConnectionRegistry, create_connection, create_database,
    database_manager::DatabaseRegistry, delete_connection, delete_database,
    driver_manager::DriverRegistry, health_check, list_databases, list_drivers,
    statement_manager::StatementRegistry, AppState,
    commit_connection, rollback_connection, cancel_connection,
};
use axum::routing::{delete, get, post};
use axum::Extension;

// Helper to build the app router for testing
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
        .layer(Extension(state))
}

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
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&body[..], b"OK");

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
    assert!(
        drivers.contains(&"sqlite".to_string()),
        "Drivers list should contain 'sqlite'"
    );
}

#[tokio::test]
async fn test_full_lifecycle_sqlite() {
    let app = app().await;

    // 1. Create Database (SQLite Memory)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{
                    "driver": "sqlite",
                    "options": { "uri": ":memory:" }
                }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let db_id = body_json["id"].as_str().unwrap().to_string();
    println!("Created Database ID: {}", db_id);

    // 2. List Databases (Verify it appears)
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
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let dbs: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert!(
        dbs.iter().any(|db| db["id"] == db_id),
        "Created database should appear in list"
    );

    // 3. Create Connection
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

    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let conn_id = body_json["id"].as_str().unwrap().to_string();
    println!("Created Connection ID: {}", conn_id);

    // 4. Delete Connection (Release to pool)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!("/connections/{}", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // 5. Delete Database
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(&format!("/databases/{}", db_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_connection_pooling_limits() {
    let app = app().await;

    // 1. Create Database
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
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let db_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 2. Acquire multiple connections
    let mut conn_ids = Vec::new();
    for _ in 0..5 {
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
        let id = serde_json::from_slice::<Value>(&body).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        conn_ids.push(id);
    }

    println!("Acquired {} connections", conn_ids.len());

    // 3. Release them all
    for id in conn_ids {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(&format!("/connections/{}", id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }
}

#[tokio::test]
async fn test_connection_actions() {
    let app = app().await;

    // 1. Create Database
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{ "driver": "sqlite", "options": { "uri": ":memory:" } }"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let db_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"].as_str().unwrap().to_string();

    // 2. Create Connection (with auto-commit disabled)
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/databases/{}/connections", db_id))
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{ "options": { "adbc.connection.autocommit": "false" } }"#))
                .unwrap(),
        )
        .await
        .unwrap();
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let conn_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"].as_str().unwrap().to_string();

    // 3. Commit connection
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/commit", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    if response.status() != StatusCode::NO_CONTENT {
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_str = String::from_utf8_lossy(&body);
        eprintln!("Commit failed with status: {}. Body: {}", status, body_str);
        panic!("Commit failed: {}", body_str);
    }

    // 4. Rollback connection
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/rollback", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    if response.status() != StatusCode::NO_CONTENT {
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_str = String::from_utf8_lossy(&body);
        eprintln!("Rollback failed with status: {}. Body: {}", status, body_str);
        panic!("Rollback failed: {}", body_str);
    }

    // 5. Cancel operation (no-op for SQLite without active query, but should not error, or return 501)
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/connections/{}/cancel", conn_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    let status = response.status();
    if status != StatusCode::NO_CONTENT && status != StatusCode::NOT_IMPLEMENTED {
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_str = String::from_utf8_lossy(&body);
        eprintln!("Cancel failed with unexpected status: {}. Body: {}", status, body_str);
        panic!("Cancel failed with unexpected status: {}", status);
    }
    // success if 204 or 501

    // Cleanup
    let _ = app.clone().oneshot(
        Request::builder()
            .method("DELETE")
            .uri(&format!("/connections/{}", conn_id))
            .body(Body::empty())
            .unwrap(),
    ).await;
    let _ = app.oneshot(
        Request::builder()
            .method("DELETE")
            .uri(&format!("/databases/{}", db_id))
            .body(Body::empty())
            .unwrap(),
    ).await;
}

#[tokio::test]
async fn test_error_handling() {
    let app = app().await;

    // 1. Create Database with invalid driver
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

    // 2. Delete non-existent Database
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

    // 3. Create Connection on non-existent Database
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

    // 4. Delete non-existent Connection
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

    // 5. Commit non-existent connection
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/non-existent-id/commit")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // 6. Rollback non-existent connection
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/non-existent-id/rollback")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    // 7. Cancel non-existent connection
    let response = app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/non-existent-id/cancel")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}