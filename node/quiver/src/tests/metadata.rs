use super::helpers::{
    app, create_test_conn, create_test_db, create_test_stmt, delete_connection, delete_database,
    delete_statement, exec_update,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::util::ServiceExt;

#[tokio::test]
async fn test_metadata_functions() {
    let app = app().await;
    let db_id = create_test_db(&app).await;
    let conn_token = create_test_conn(&app, &db_id).await;

    let stmt_token = create_test_stmt(&app, &conn_token).await;
    exec_update(
        &app,
        &stmt_token,
        "CREATE TABLE meta_test (id INT, val TEXT)",
    )
    .await;

    // Get Info
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/connections/info")
                .header("Authorization", format!("Bearer {}", conn_token))
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

    // Get Table Types
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/connections/table-types")
                .header("Authorization", format!("Bearer {}", conn_token))
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

    // Get Objects
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/connections/objects")
                .header("Authorization", format!("Bearer {}", conn_token))
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

    // Get Schema (still JSON for now)
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/connections/tables/meta_test/schema")
                .header("Authorization", format!("Bearer {}", conn_token))
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

    delete_statement(&app, &stmt_token).await;
    delete_connection(&app, &conn_token).await;
    delete_database(&app, &db_id).await;
}
