use axum::{
    routing::{get, post, delete},
    Router,
    Extension, Json,
    extract::Path,
    http::StatusCode,
};
use std::net::SocketAddr;
use std::collections::HashMap;
use std::sync::Arc;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use adbc_core::{Driver, Optionable, options::{OptionDatabase, OptionValue}};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod driver_manager;
mod database_manager;
mod connection_manager;
mod statement_manager;

use crate::driver_manager::DriverRegistry;
use crate::database_manager::DatabaseRegistry;
use crate::connection_manager::ConnectionRegistry;
use crate::statement_manager::StatementRegistry;

#[cfg(test)]
mod tests;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,
}

// Application state shared across handlers
struct AppState {
    driver_registry: Arc<DriverRegistry>,
    database_registry: Arc<DatabaseRegistry>,
    connection_registry: Arc<ConnectionRegistry>,
    statement_registry: Arc<StatementRegistry>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct CreateDatabaseRequest {
    #[schema(example = "sqlite")]
    driver: String,
    #[serde(default)]
    #[schema(example = "{\"uri\": \":memory:\"}")]
    options: HashMap<String, String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateDatabaseResponse {
    id: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateConnectionResponse {
    id: String,
}

#[derive(OpenApi)]
#[openapi(
    paths(
        health_check,
        list_drivers,
        list_databases,
        create_database,
        delete_database,
        create_connection,
        delete_connection
    ),
    components(schemas(CreateDatabaseRequest, CreateDatabaseResponse, CreateConnectionResponse, crate::database_manager::DatabaseInfo)),
    tags((
        name = "quiver",
        description = "ADBC Gateway API"
    ))
)]
struct ApiDoc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "quiver=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();

    tracing::info!("Starting ADBC Gateway on port {}", args.port);

    // Discover and load drivers
    let driver_registry = DriverRegistry::new().map_err(|e| {
        tracing::error!("Failed to initialize driver registry: {:?}", e);
        e
    })?;

    if driver_registry.list_drivers().is_empty() {
        tracing::warn!("No ADBC drivers found. The gateway will start without any active database connections.");
    } else {
        tracing::info!("Discovered and loaded drivers: {:?}", driver_registry.list_drivers());
    }

    let database_registry = DatabaseRegistry::new();
    let connection_registry = ConnectionRegistry::new();
    let statement_registry = StatementRegistry::new();

    let state = Arc::new(AppState {
        driver_registry: Arc::new(driver_registry),
        database_registry: Arc::new(database_registry),
        connection_registry: Arc::new(connection_registry),
        statement_registry: Arc::new(statement_registry),
    });

    // Build our application
    let app = Router::new()
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/", get(|| async { "Hello world" }))
        .route("/health", get(health_check))
        .route("/drivers", get(list_drivers))
        .route("/databases", get(list_databases).post(create_database))
        .route("/databases/:id", delete(delete_database))
        .route("/databases/:id/connections", post(create_connection))
        .route("/connections/:id", delete(delete_connection))
        .layer(Extension(state));

    // Run it
    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Server listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}

#[utoipa::path(
    get,
    path = "/health",
    responses((
        status = 200,
        description = "Health check passed",
        body = String
    ))
)]
async fn health_check() -> &'static str {
    "OK"
}

#[utoipa::path(
    get,
    path = "/drivers",
    responses((
        status = 200,
        description = "List available drivers",
        body = Vec<String>
    ))
)]
async fn list_drivers(Extension(state): Extension<Arc<AppState>>) -> Json<Vec<String>> {
    Json(state.driver_registry.list_drivers())
}

#[utoipa::path(
    get,
    path = "/databases",
    responses((
        status = 200,
        description = "List active databases",
        body = Vec<DatabaseInfo>
    ))
)]
async fn list_databases(Extension(state): Extension<Arc<AppState>>) -> Json<Vec<crate::database_manager::DatabaseInfo>> {
    let dbs = state.database_registry.list().await;
    Json(dbs)
}

#[utoipa::path(
    post,
    path = "/databases",
    request_body = CreateDatabaseRequest,
    responses((
        status = 200,
        description = "Database created successfully",
        body = CreateDatabaseResponse
    ), (status = 400, description = "Bad Request"), (status = 500, description = "Internal Server Error"))
)]
async fn create_database(
    Extension(state): Extension<Arc<AppState>>,
    Json(payload): Json<CreateDatabaseRequest>,
) -> Result<Json<CreateDatabaseResponse>, (StatusCode, String)> {
    
    // 1. Find the driver
    let driver_manager_arc = state.driver_registry.get_driver(&payload.driver)
        .ok_or((StatusCode::BAD_REQUEST, format!("Driver '{}' not found", payload.driver)))?;

    // 2. Prepare Options
    let mut adbc_options = Vec::new();
    for (key, value) in payload.options {
        let opt_key = match key.to_lowercase().as_str() {
            "uri" => OptionDatabase::Uri,
            "username" => OptionDatabase::Username,
            "password" => OptionDatabase::Password,
            _ => OptionDatabase::Other(key),
        };
        let opt_val = OptionValue::String(value);
        adbc_options.push((opt_key, opt_val));
    }

    // 3. Create Database with Options (needs lock for mutable access)
    // new_database_with_opts handles allocation, setting options, and initialization atomically.
    let database = {
        let mut driver_guard = driver_manager_arc.lock().await;
        driver_guard.new_database_with_opts(adbc_options)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create database: {}", e)))? 
    };

    // 4. Register
    let id = state.database_registry.register(payload.driver.clone(), database).await;

    tracing::info!("Created database '{}' with driver '{}'", id, payload.driver);

    Ok(Json(CreateDatabaseResponse { id }))
}

#[utoipa::path(
    delete,
    path = "/databases/{id}",
    params((
        "id" = String,
        Path,
        description = "Database ID to delete"
    )),
    responses((
        status = 204,
        description = "Database deleted"
    ), (status = 404, description = "Database not found"))
)]
async fn delete_database(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    if state.database_registry.remove(&id).await.is_some() {
        tracing::info!("Deleted database '{}'", id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, format!("Database '{}' not found", id)))
    }
}

#[utoipa::path(
    post,
    path = "/databases/{id}/connections",
    params((
        "id" = String,
        Path,
        description = "Database ID to acquire connection from"
    )),
    responses((
        status = 200,
        description = "Connection acquired successfully",
        body = CreateConnectionResponse
    ), (status = 404, description = "Database not found"), (status = 500, description = "Failed to acquire connection"))
)]
async fn create_connection(
    Extension(state): Extension<Arc<AppState>>,
    Path(db_id): Path<String>,
) -> Result<Json<CreateConnectionResponse>, (StatusCode, String)> {
    // 1. Get the database
    let db_entry = state.database_registry.get(&db_id).await
        .ok_or((StatusCode::NOT_FOUND, format!("Database '{}' not found", db_id)))?;

    // 2. Acquire connection from pool
    let connection = db_entry.acquire_connection().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to acquire connection: {}", e)))?;

    // 3. Register the connection (session)
    let conn_id = state.connection_registry.register(connection).await;

    tracing::info!("Acquired connection '{}' from database '{}'", conn_id, db_id);

    Ok(Json(CreateConnectionResponse { id: conn_id }))
}

#[utoipa::path(
    delete,
    path = "/connections/{id}",
    params((
        "id" = String,
        Path,
        description = "Connection ID to release"
    )),
    responses((
        status = 204,
        description = "Connection released"
    ), (status = 404, description = "Connection not found"))
)]
async fn delete_connection(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    if state.connection_registry.remove(&id).await.is_some() {
        // Dropping the entry will drop the AdbcConnectionObject, 
        // which automatically returns the connection to the pool.
        tracing::info!("Released connection '{}'", id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, format!("Connection '{}' not found", id)))
    }
}