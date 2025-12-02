use axum::{body::Body, http::{Request, StatusCode}};
use tower::util::ServiceExt;
use super::helpers::app;

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
