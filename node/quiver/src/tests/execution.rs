use axum::{body::Body, http::{Request, StatusCode}};
use serde_json::Value;
use tower::util::ServiceExt;
use super::helpers::{app, create_test_db, create_test_conn, create_test_stmt, exec_update, delete_resource};

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
