use super::helpers::{
    app, create_test_conn, create_test_db, create_test_stmt, delete_connection, delete_database,
    delete_statement,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::util::ServiceExt;

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

    let conn_token = create_test_conn(&app, &db_id).await;
    println!("Created Connection Token");

    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}

#[tokio::test]
async fn test_database_metadata() {
    let app = app().await;

    // 1. Create Database with Name
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/databases")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "driver": "sqlite", "options": { "uri": ":memory:" }, "name": "my_custom_db" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let db_id = serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 2. Get Database Info
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/databases/{}", db_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let db_info: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(db_info["id"], db_id);
    assert_eq!(db_info["driver_name"], "sqlite");
    assert_eq!(db_info["name"], "my_custom_db");

    // 3. Create Database WITHOUT Name
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
    let db_id_no_name = serde_json::from_slice::<Value>(&body).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 4. Get Database Info (No Name)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(&format!("/databases/{}", db_id_no_name))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let db_info_no_name: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(db_info_no_name["id"], db_id_no_name);
    // Name field should be absent or null depending on serialization config.
    // We used #[serde(skip_serializing_if = "Option::is_none")] so it should be absent.
    assert!(db_info_no_name.get("name").is_none());

    delete_database(&app, &db_id).await;
    delete_database(&app, &db_id_no_name).await;
}

#[tokio::test]
async fn test_connection_pooling_limits() {
    let app = app().await;
    let db_id = create_test_db(&app).await;

    let mut conn_tokens = Vec::new();
    for _ in 0..5 {
        conn_tokens.push(create_test_conn(&app, &db_id).await);
    }
    println!("Acquired {} connections", conn_tokens.len());

    for token in conn_tokens {
        delete_connection(&app, &token).await;
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
    let conn_token = serde_json::from_slice::<Value>(&body).unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Commit
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/commit")
                .header("Authorization", format!("Bearer {}", conn_token))
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
                .uri("/connections/rollback")
                .header("Authorization", format!("Bearer {}", conn_token))
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
                .uri("/connections/cancel")
                .header("Authorization", format!("Bearer {}", conn_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status() == StatusCode::NO_CONTENT
            || response.status() == StatusCode::NOT_IMPLEMENTED
    );

    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}

#[tokio::test]
async fn test_set_options() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;

    // Set Connection Option
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/options")
                .header("Authorization", format!("Bearer {}", conn_token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "key": "adbc.connection.autocommit", "value": "false" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // TODO: Test Statement Options if there's a reliable one to test with SQLite

    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}

#[tokio::test]
async fn test_statement_lifecycle() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;
    let stmt_token = create_test_stmt(&app, &conn_token).await;

    // Set SQL
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/sql")
                .header("Authorization", format!("Bearer {}", stmt_token))
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
                .uri("/statements/prepare")
                .header("Authorization", format!("Bearer {}", stmt_token))
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
                .uri("/statements/execute_update")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    delete_statement(&app, &stmt_token).await;
    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
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

    // Test missing auth for connection delete
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/connections")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST); // Missing Credentials

    // Test missing auth for statement creation
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/statements")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST); // Missing Credentials
}
