use adbc_core::{
    options::{ObjectDepth, OptionConnection, OptionDatabase, OptionValue},
    Connection, Driver, Optionable, Statement,
};
use adbc_driver_manager::{ManagedConnection, ManagedStatement};
use arrow::array::RecordBatchReader;
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use clap::Parser;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod auth;
mod connection_manager;
mod database_manager;
mod driver_manager;
mod statement_manager;

use crate::auth::{sign_token, ConnectionClaims, Scope, StatementClaims};
use crate::connection_manager::ConnectionRegistry;
use crate::database_manager::DatabaseRegistry;
use crate::driver_manager::DriverRegistry;
use crate::statement_manager::StatementRegistry;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};

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

#[derive(serde::Deserialize, utoipa::IntoParams)]
struct GetObjectsParams {
    depth: Option<u8>,
    catalog: Option<String>,
    db_schema: Option<String>,
    table_name: Option<String>,
    #[serde(default)]
    table_type: Option<Vec<String>>,
    column_name: Option<String>,
}

#[derive(serde::Deserialize, utoipa::IntoParams)]
struct GetTableSchemaParams {
    catalog: Option<String>,
    db_schema: Option<String>,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct CreateDatabaseRequest {
    #[schema(example = r#"{"uri": ":memory:"}"#)]
    driver: String,
    #[serde(default)]
    options: HashMap<String, String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateDatabaseResponse {
    id: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct CreateConnectionRequest {
    #[serde(default)]
    #[schema(example = r#"{"adbc.connection.autocommit": "false"}"#)]
    options: HashMap<String, String>,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateConnectionResponse {
    token: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateStatementResponse {
    token: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct SetSqlQueryRequest {
    query: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct QueryRequest {
    query: String,
}

// A bridge to write to a Tokio channel from a synchronous Writer
struct ChannelWriter {
    sender: tokio::sync::mpsc::Sender<Result<axum::body::Bytes, std::io::Error>>,
}

impl std::io::Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let bytes = axum::body::Bytes::copy_from_slice(buf);
        // We use blocking_send here because this is run inside spawn_blocking
        match self.sender.blocking_send(Ok(bytes)) {
            Ok(_) => Ok(buf.len()),
            Err(_) => Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Channel closed",
            )),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[utoipa::path(
    post,
    path = "/connections/query",
    security(
        ("bearer_auth" = [])
    ),
    request_body = QueryRequest,
    responses((
        status = 200,
        description = "Arrow IPC Stream",
        content_type = "application/vnd.apache.arrow.stream",
        body = Vec<u8>
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to execute query"))
)]
async fn query_connection_ipc(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
    Json(payload): Json<QueryRequest>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let conn_id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&conn_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", conn_id),
    ))?;

    // Clone the Arc to the entry so we can move it into the blocking task
    let entry_arc = conn_entry.clone();
    let query = payload.query.clone();

    // Create a channel for streaming bytes
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(2);

    // Spawn blocking task to handle the entire Statement lifecycle (Create -> Execute -> Stream -> Drop)
    tokio::task::spawn_blocking(move || {
        // We use blocking_lock because we are in a blocking task.
        // Ensure the connection isn't held too long, but we need it for the statement creation.
        let mut conn_guard = entry_arc.connection.blocking_lock();
        let managed_conn = &mut ***conn_guard;

        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let mut statement = managed_conn.new_statement()?;
            statement.set_sql_query(&query)?;
            let reader = statement.execute()?;

            let mut channel_writer = ChannelWriter { sender: tx.clone() };
            let schema = reader.schema();
            let mut writer =
                arrow::ipc::writer::StreamWriter::try_new(&mut channel_writer, &schema)?;

            for batch in reader {
                let b = batch?;
                writer.write(&b)?;
            }
            writer.finish()?;
            Ok(())
        })();

        if let Err(e) = result {
            tracing::error!("Streaming error: {}", e);
            // Try to send error down channel if possible, or just close it
            let _ = tx.blocking_send(Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )));
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/vnd.apache.arrow.stream")
        .body(body)
        .unwrap())
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
        delete_connection,
        commit_connection,
        rollback_connection,
        cancel_connection,
        create_statement,
        delete_statement,
        set_statement_sql_query,
        prepare_statement,
        execute_statement_update,
        execute_statement_query,
        get_connection_info,
        get_connection_objects,
        get_connection_table_types,
        get_connection_table_schema
    ),
    components(schemas(
        CreateDatabaseRequest,
        CreateDatabaseResponse,
        CreateConnectionRequest,
        CreateConnectionResponse,
        CreateStatementResponse,
        SetSqlQueryRequest,
        QueryRequest,
        crate::database_manager::DatabaseInfo,
        crate::auth::Claims,
        crate::auth::Scope
    )),
    modifiers(&SecurityAddon),
    tags((
        name = "quiver",
        description = "ADBC Gateway API"
    ))
)]
pub(crate) struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.as_mut().unwrap();
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

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
        tracing::info!(
            "Discovered and loaded drivers: {:?}",
            driver_registry.list_drivers()
        );
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
        .route("/connections", delete(delete_connection))
        .route("/connections/commit", post(commit_connection))
        .route("/connections/rollback", post(rollback_connection))
        .route("/connections/cancel", post(cancel_connection))
        .route("/connections/query", post(query_connection_ipc))
        .route("/connections/info", get(get_connection_info))
        .route("/connections/objects", get(get_connection_objects))
        .route("/connections/table-types", get(get_connection_table_types))
        .route(
            "/connections/tables/:table_name/schema",
            get(get_connection_table_schema),
        )
        .route("/connections/statements", post(create_statement))
        .route("/statements", delete(delete_statement))
        .route("/statements/sql", post(set_statement_sql_query))
        .route("/statements/prepare", post(prepare_statement))
        .route("/statements/execute", post(execute_statement_query))
        .route("/statements/execute_update", post(execute_statement_update))
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
async fn list_databases(
    Extension(state): Extension<Arc<AppState>>,
) -> Json<Vec<crate::database_manager::DatabaseInfo>> {
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
    let driver_manager_arc = state.driver_registry.get_driver(&payload.driver).ok_or((
        StatusCode::BAD_REQUEST,
        format!("Driver '{}' not found", payload.driver),
    ))?;

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
        driver_guard
            .new_database_with_opts(adbc_options)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create database: {}", e),
                )
            })?
    };

    // 4. Register
    let id = state
        .database_registry
        .register(payload.driver.clone(), database)
        .await;

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
        Err((
            StatusCode::NOT_FOUND,
            format!("Database '{}' not found", id),
        ))
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
    request_body = Option<CreateConnectionRequest>,
    responses((
        status = 200,
        description = "Connection acquired successfully",
        body = CreateConnectionResponse
    ), (status = 404, description = "Database not found"), (status = 500, description = "Failed to acquire connection"))
)]
async fn create_connection(
    Extension(state): Extension<Arc<AppState>>,
    Path(db_id): Path<String>,
    payload: Option<Json<CreateConnectionRequest>>,
) -> Result<Json<CreateConnectionResponse>, (StatusCode, String)> {
    // 1. Get the database
    let db_entry = state.database_registry.get(&db_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Database '{}' not found", db_id),
    ))?;

    // 2. Acquire connection from pool
    let mut connection = db_entry.acquire_connection().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to acquire connection: {}", e),
        )
    })?;

    // 3. Apply Options if provided
    if let Some(Json(req)) = payload {
        for (key, value) in req.options {
            let opt_key = match key.to_lowercase().as_str() {
                "adbc.connection.autocommit" => OptionConnection::AutoCommit,
                "adbc.connection.readonly" => OptionConnection::ReadOnly,
                _ => OptionConnection::Other(key),
            };
            let opt_val = OptionValue::String(value);

            let managed_conn = &mut **connection;
            Optionable::set_option(managed_conn, opt_key, opt_val).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    format!("Failed to set option: {}", e),
                )
            })?;
        }
    }

    // 4. Register the connection (session)
    let conn_id = state.connection_registry.register(connection).await;

    // 5. Generate Token
    let token = sign_token(conn_id.clone(), Scope::Connection).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to generate connection token".to_string(),
        )
    })?;

    tracing::info!(
        "Acquired connection '{}' from database '{}'",
        conn_id,
        db_id
    );

    Ok(Json(CreateConnectionResponse { token }))
}

#[utoipa::path(
    delete,
    path = "/connections",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Connection released"
    ), (status = 404, description = "Connection not found"))
)]
async fn delete_connection(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    let id = claims.0.sub;
    if state.connection_registry.remove(&id).await.is_some() {
        tracing::info!("Released connection '{}'", id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::NOT_FOUND,
            format!("Connection '{}' not found", id),
        ))
    }
}

async fn handle_connection_action(
    state: Extension<Arc<AppState>>,
    conn_id: String,
    action: impl FnOnce(&mut ManagedConnection) -> Result<(), adbc_core::error::Error>,
    action_name: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    let conn_entry = state.connection_registry.get(&conn_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", conn_id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
    let managed_conn = &mut ***conn_guard;

    action(managed_conn).map_err(|e| {
        let status = match e.status {
            adbc_core::error::Status::NotImplemented => StatusCode::NOT_IMPLEMENTED,
            adbc_core::error::Status::InvalidState => StatusCode::CONFLICT,
            adbc_core::error::Status::InvalidArguments => StatusCode::BAD_REQUEST,
            adbc_core::error::Status::NotFound => StatusCode::NOT_FOUND,
            adbc_core::error::Status::AlreadyExists => StatusCode::CONFLICT,
            adbc_core::error::Status::Unauthenticated => StatusCode::UNAUTHORIZED,
            adbc_core::error::Status::IO => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            format!(
                "Failed to {}: {} (ADBC Status: {:?})",
                action_name, e.message, e.status
            ),
        )
    })?;

    tracing::info!("Connection '{}' {}.", conn_id, action_name);
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/connections/commit",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Transaction committed"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to commit transaction"))
)]
async fn commit_connection(
    state: Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(
        state,
        claims.0.sub,
        |conn| conn.commit(),
        "commit transaction",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/connections/rollback",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Transaction rolled back"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to rollback transaction"))
)]
async fn rollback_connection(
    state: Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(
        state,
        claims.0.sub,
        |conn| conn.rollback(),
        "rollback transaction",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/connections/cancel",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Operation cancelled"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to cancel operation"))
)]
async fn cancel_connection(
    state: Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(
        state,
        claims.0.sub,
        |conn| conn.cancel(),
        "cancel operation",
    )
    .await
}
#[utoipa::path(
    post,
    path = "/connections/statements",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 200,
        description = "Statement created",
        body = CreateStatementResponse
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to create statement"))
)]
async fn create_statement(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<Json<CreateStatementResponse>, (StatusCode, String)> {
    let conn_id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&conn_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", conn_id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
    let managed_conn = &mut ***conn_guard;

    let statement = managed_conn.new_statement().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to create statement: {}", e),
        )
    })?;

    let stmt_id = state.statement_registry.register(statement).await;
    let token = sign_token(stmt_id.clone(), Scope::Statement).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to generate statement token".to_string(),
        )
    })?;

    tracing::info!(
        "Created statement '{}' from connection '{}'",
        stmt_id,
        conn_id
    );
    Ok(Json(CreateStatementResponse { token }))
}

#[utoipa::path(
    delete,
    path = "/statements",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Statement released"
    ), (status = 404, description = "Statement not found"))
)]
async fn delete_statement(
    Extension(state): Extension<Arc<AppState>>,
    claims: StatementClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    let id = claims.0.sub;
    if state.statement_registry.remove(&id).await.is_some() {
        tracing::info!("Released statement '{}'", id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::NOT_FOUND,
            format!("Statement '{}' not found", id),
        ))
    }
}

async fn handle_statement_action(
    state: Extension<Arc<AppState>>,
    stmt_id: String,
    action: impl FnOnce(&mut ManagedStatement) -> Result<(), adbc_core::error::Error>,
    action_name: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    let stmt_entry = state.statement_registry.get(&stmt_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Statement '{}' not found", stmt_id),
    ))?;

    let mut stmt_guard = stmt_entry.statement.lock().await;

    action(&mut *stmt_guard).map_err(|e| {
        let status = match e.status {
            adbc_core::error::Status::NotImplemented => StatusCode::NOT_IMPLEMENTED,
            adbc_core::error::Status::InvalidState => StatusCode::CONFLICT,
            adbc_core::error::Status::InvalidArguments => StatusCode::BAD_REQUEST,
            adbc_core::error::Status::NotFound => StatusCode::NOT_FOUND,
            adbc_core::error::Status::AlreadyExists => StatusCode::CONFLICT,
            adbc_core::error::Status::Unauthenticated => StatusCode::UNAUTHORIZED,
            adbc_core::error::Status::IO => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            format!(
                "Failed to {}: {} (ADBC Status: {:?})",
                action_name, e.message, e.status
            ),
        )
    })?;

    tracing::info!("Statement '{}' {}.", stmt_id, action_name);
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/statements/sql",
    security(
        ("bearer_auth" = [])
    ),
    request_body = SetSqlQueryRequest,
    responses((
        status = 204,
        description = "SQL query set"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to set SQL query"))
)]
async fn set_statement_sql_query(
    state: Extension<Arc<AppState>>,
    claims: StatementClaims,
    Json(payload): Json<SetSqlQueryRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(
        state,
        claims.0.sub,
        move |stmt| stmt.set_sql_query(&payload.query),
        "set SQL query",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/statements/prepare",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Statement prepared"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to prepare statement"))
)]
async fn prepare_statement(
    state: Extension<Arc<AppState>>,
    claims: StatementClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(
        state,
        claims.0.sub,
        |stmt| stmt.prepare(),
        "prepare statement",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/statements/execute_update",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 204,
        description = "Update executed"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to execute update"))
)]
async fn execute_statement_update(
    state: Extension<Arc<AppState>>,
    claims: StatementClaims,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(
        state,
        claims.0.sub,
        |stmt| stmt.execute_update().map(|_| ()),
        "execute update",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/statements/execute",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 200,
        description = "Query executed",
        content_type = "application/vnd.apache.arrow.stream",
        body = Vec<u8>
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to execute query"))
)]
async fn execute_statement_query(
    Extension(state): Extension<Arc<AppState>>,
    claims: StatementClaims,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let stmt_id = claims.0.sub;
    let stmt_entry = state.statement_registry.get(&stmt_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Statement '{}' not found", stmt_id),
    ))?;

    // Clone entry to move into blocking task
    let entry_arc = stmt_entry.clone();

    // Create a channel for streaming bytes
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(2);

    // Spawn blocking task
    tokio::task::spawn_blocking(move || {
        let mut stmt_guard = entry_arc.statement.blocking_lock();
        // In adbc_driver_manager, ManagedStatement wraps the ADBC statement.

        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let reader = stmt_guard.execute()?;

            let mut channel_writer = ChannelWriter { sender: tx.clone() };
            let schema = reader.schema();
            let mut writer =
                arrow::ipc::writer::StreamWriter::try_new(&mut channel_writer, &schema)?;

            for batch in reader {
                let b = batch?;
                writer.write(&b)?;
            }
            writer.finish()?;
            Ok(())
        })();

        if let Err(e) = result {
            tracing::error!("Streaming error: {}", e);
            let _ = tx.blocking_send(Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )));
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/vnd.apache.arrow.stream")
        .body(body)
        .unwrap())
}

#[utoipa::path(
    get,
    path = "/connections/info",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 200,
        description = "Database metadata info",
        content_type = "application/vnd.apache.arrow.stream",
        body = Vec<u8>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_info(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let entry_arc = conn_entry.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(2);

    tokio::task::spawn_blocking(move || {
        let mut conn_guard = entry_arc.connection.blocking_lock();
        let managed_conn = &mut ***conn_guard;

        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let reader = managed_conn.get_info(None)?;

            let mut channel_writer = ChannelWriter { sender: tx.clone() };
            let schema = reader.schema();
            let mut writer =
                arrow::ipc::writer::StreamWriter::try_new(&mut channel_writer, &schema)?;

            for batch in reader {
                let b = batch?;
                writer.write(&b)?;
            }
            writer.finish()?;
            Ok(())
        })();

        if let Err(e) = result {
            tracing::error!("Streaming error: {}", e);
            let _ = tx.blocking_send(Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )));
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/vnd.apache.arrow.stream")
        .body(body)
        .unwrap())
}

#[utoipa::path(
    get,
    path = "/connections/objects",
    security(
        ("bearer_auth" = [])
    ),
    params(
        GetObjectsParams
    ),
    responses((
        status = 200,
        description = "Database objects",
        content_type = "application/vnd.apache.arrow.stream",
        body = Vec<u8>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_objects(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
    Query(params): Query<GetObjectsParams>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let entry_arc = conn_entry.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(2);

    tokio::task::spawn_blocking(move || {
        let mut conn_guard = entry_arc.connection.blocking_lock();
        let managed_conn = &mut ***conn_guard;

        let depth = match params.depth.unwrap_or(0) {
            0 => ObjectDepth::All,
            1 => ObjectDepth::Catalogs,
            2 => ObjectDepth::Schemas,
            3 => ObjectDepth::Tables,
            4 => ObjectDepth::Columns,
            _ => ObjectDepth::All,
        };

        let table_types = params
            .table_type
            .map(|v| v.into_iter().collect::<Vec<String>>());
        let table_types_slices: Option<Vec<&str>> = table_types
            .as_ref()
            .map(|v| v.iter().map(|s| s.as_str()).collect());

        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let reader = managed_conn.get_objects(
                depth,
                params.catalog.as_deref(),
                params.db_schema.as_deref(),
                params.table_name.as_deref(),
                table_types_slices,
                params.column_name.as_deref(),
            )?;

            let mut channel_writer = ChannelWriter { sender: tx.clone() };
            let schema = reader.schema();
            let mut writer =
                arrow::ipc::writer::StreamWriter::try_new(&mut channel_writer, &schema)?;

            for batch in reader {
                let b = batch?;
                writer.write(&b)?;
            }
            writer.finish()?;
            Ok(())
        })();

        if let Err(e) = result {
            tracing::error!("Streaming error: {}", e);
            let _ = tx.blocking_send(Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )));
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/vnd.apache.arrow.stream")
        .body(body)
        .unwrap())
}

#[utoipa::path(
    get,
    path = "/connections/table-types",
    security(
        ("bearer_auth" = [])
    ),
    responses((
        status = 200,
        description = "Table types",
        content_type = "application/vnd.apache.arrow.stream",
        body = Vec<u8>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_table_types(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let entry_arc = conn_entry.clone();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(2);

    tokio::task::spawn_blocking(move || {
        let mut conn_guard = entry_arc.connection.blocking_lock();
        let managed_conn = &mut ***conn_guard;

        let result = (|| -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
            let reader = managed_conn.get_table_types()?;

            let mut channel_writer = ChannelWriter { sender: tx.clone() };
            let schema = reader.schema();
            let mut writer =
                arrow::ipc::writer::StreamWriter::try_new(&mut channel_writer, &schema)?;

            for batch in reader {
                let b = batch?;
                writer.write(&b)?;
            }
            writer.finish()?;
            Ok(())
        })();

        if let Err(e) = result {
            tracing::error!("Streaming error: {}", e);
            let _ = tx.blocking_send(Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )));
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/vnd.apache.arrow.stream")
        .body(body)
        .unwrap())
}

#[utoipa::path(
    get,
    path = "/connections/tables/{table_name}/schema",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("table_name" = String, Path, description = "Table Name"),
        GetTableSchemaParams
    ),
    responses((
        status = 200,
        description = "Table schema",
        body = Value
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_table_schema(
    Extension(state): Extension<Arc<AppState>>,
    claims: ConnectionClaims,
    Path(table_name): Path<String>,
    Query(params): Query<GetTableSchemaParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let id = claims.0.sub;
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
    let managed_conn = &mut ***conn_guard;

    let schema = managed_conn
        .get_table_schema(
            params.catalog.as_deref(),
            params.db_schema.as_deref(),
            &table_name,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get table schema: {}", e),
            )
        })?;

    let json_val = serde_json::to_value(schema).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Schema serialization error: {}", e),
        )
    })?;

    Ok(Json(json_val))
}
