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
async fn test_bind_parameters() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;

    // Create Table
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(
        &app,
        &stmt_token,
        "CREATE TABLE bind_test (id INT, val TEXT)",
    )
    .await;

    // Prepare Insert Statement
    let _ = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/sql")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "query": "INSERT INTO bind_test VALUES (?, ?)" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    let _ = app
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

    // Create Parameter Batch
    let id_array = arrow::array::Int32Array::from(vec![1, 2]);
    let val_array = arrow::array::StringArray::from(vec!["one", "two"]);
    let batch = arrow::array::RecordBatch::try_from_iter(vec![
        (
            "id",
            std::sync::Arc::new(id_array) as arrow::array::ArrayRef,
        ),
        (
            "val",
            std::sync::Arc::new(val_array) as arrow::array::ArrayRef,
        ),
    ])
    .unwrap();

    // Serialize to IPC
    let mut buf = Vec::new();
    {
        let mut writer =
            arrow::ipc::writer::StreamWriter::try_new(&mut buf, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
    }

    // Bind Parameters
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/bind")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/vnd.apache.arrow.stream")
                .body(Body::from(buf))
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

#[tokio::test]
#[ignore] // Ignored until we confirm driver support for Ingest options via SetOption
async fn test_statement_options_ingest() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;
    let stmt_token = create_test_stmt(&app, &conn_token).await;

    // Set Ingest Options
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/options")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "key": "adbc.ingest.target_table", "value": "bulk_ingest_test" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/options")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "key": "adbc.ingest.mode", "value": "create" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Create Data Batch
    let id_array = arrow::array::Int32Array::from(vec![1, 2, 3]);
    let batch = arrow::array::RecordBatch::try_from_iter(vec![(
        "id",
        std::sync::Arc::new(id_array) as arrow::array::ArrayRef,
    )])
    .unwrap();

    // Serialize to IPC
    let mut buf = Vec::new();
    {
        let mut writer =
            arrow::ipc::writer::StreamWriter::try_new(&mut buf, &batch.schema()).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
    }

    // Bind Data (Ingestion payload)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/bind")
                .header("Authorization", format!("Bearer {}", stmt_token))
                .header("Content-Type", "application/vnd.apache.arrow.stream")
                .body(Body::from(buf))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    // Execute Update (Perform Ingest)
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

    // Verify Data
    let query_stmt_token = create_test_stmt(&app, &conn_token).await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/sql")
                .header("Authorization", format!("Bearer {}", query_stmt_token))
                .header("Content-Type", "application/json")
                .body(Body::from(
                    r#"{ "query": "SELECT * FROM bulk_ingest_test" }"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/statements/execute")
                .header("Authorization", format!("Bearer {}", query_stmt_token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body.len() > 0);

    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}

#[tokio::test]
async fn test_query_database_direct() {
    let app = app().await;
    let db_id = create_test_db(&app).await;

    // We need to populate data first. We can use a temp connection for that.
    let conn_token = create_test_conn(&app, &db_id).await;
    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(&app, &stmt_token, "CREATE TABLE direct_test (id INT)").await;
    exec_update(&app, &stmt_token, "INSERT INTO direct_test VALUES (42)").await;
    delete_statement(&app, &stmt_token).await;
    delete_connection(&app, &conn_token).await;

    // Query directly using Database ID (stateless)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&format!("/databases/{}/query", db_id))
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{ "query": "SELECT * FROM direct_test" }"#))
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

    delete_database(&app, &db_id).await;
}
