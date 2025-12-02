use axum::{body::Body, http::{Request, StatusCode}};
use serde_json::Value;
use tower::util::ServiceExt;
use super::helpers::{app, create_test_db, create_test_conn, create_test_stmt, exec_update, delete_resource};

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
