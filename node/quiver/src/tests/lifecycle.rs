use axum::{body::Body, http::{Request, StatusCode}};
use serde_json::Value;
use tower::util::ServiceExt;
use super::helpers::{app, create_test_db, create_test_conn, create_test_stmt, delete_resource};

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
