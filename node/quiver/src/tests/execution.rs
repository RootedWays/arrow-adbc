use super::helpers::{
    app, create_test_conn, create_test_db, create_test_stmt, delete_connection, delete_database,
    delete_statement, exec_update,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::util::ServiceExt;

#[tokio::test]
async fn test_execute_query() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;

    // Create Table
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(
        &app,
        &stmt_token,
        "CREATE TABLE query_test (id INT, val TEXT)",
    )
    .await;
    delete_statement(&app, &stmt_token).await;

    // Insert Data
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(
        &app,
        &stmt_token,
        "INSERT INTO query_test VALUES (1, 'alpha'), (2, 'beta')",
    )
    .await;
    delete_statement(&app, &stmt_token).await;

    // Select Data
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/sql")
                .header("Authorization", format!("Bearer {}", stmt_token))
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
                .uri("/statements/execute")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("Content-Type").unwrap(),
        "application/vnd.apache.arrow.stream"
    );

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body.len() > 0);

    delete_statement(&app, &stmt_token).await;
    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}

#[tokio::test]
async fn test_execute_query_ipc() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;

    // Create Data
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(
        &app,
        &stmt_token,
        "CREATE TABLE ipc_test (id INT, val TEXT)",
    )
    .await;
    exec_update(&app, &stmt_token, "INSERT INTO ipc_test VALUES (1, 'ipc')").await;
    delete_statement(&app, &stmt_token).await;

    // Execute Query via Convenience Endpoint
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/connections/query")
                .header("Authorization", format!("Bearer {}", conn_token))
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{ "query": "SELECT * FROM ipc_test" }"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get("Content-Type").unwrap(),
        "application/vnd.apache.arrow.stream"
    );

    // Check body is not empty (basic check)
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body.len() > 0);
    // In a real scenario, we would use arrow-ipc to read this back and verify contents.

    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}
