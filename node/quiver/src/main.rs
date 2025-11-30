use adbc_core::{
    options::{ObjectDepth, OptionConnection, OptionDatabase, OptionValue},
    Connection, Driver, Optionable, Statement,
};
use adbc_driver_manager::{ManagedConnection, ManagedStatement};
use arrow::array::{
    Array, BooleanArray, Int32Array, Int64Array, StringArray, UInt32Array, UnionArray,
};
use arrow_json::writer::LineDelimited;
use arrow_json::WriterBuilder;
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

mod connection_manager;
mod database_manager;
mod driver_manager;
mod statement_manager;

use crate::connection_manager::ConnectionRegistry;
use crate::database_manager::DatabaseRegistry;
use crate::driver_manager::DriverRegistry;
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
    id: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
struct CreateStatementResponse {
    id: String,
}

#[derive(serde::Deserialize, utoipa::ToSchema)]
struct SetSqlQueryRequest {
    query: String,
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
        crate::database_manager::DatabaseInfo
    )),
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
        .route("/connections/:id", delete(delete_connection))
        .route("/connections/:id/commit", post(commit_connection))
        .route("/connections/:id/rollback", post(rollback_connection))
        .route("/connections/:id/cancel", post(cancel_connection))
        .route("/connections/:id/info", get(get_connection_info))
        .route("/connections/:id/objects", get(get_connection_objects))
        .route(
            "/connections/:id/table-types",
            get(get_connection_table_types),
        )
        .route(
            "/connections/:id/tables/:table_name/schema",
            get(get_connection_table_schema),
        )
        .route("/connections/:id/statements", post(create_statement))
        .route("/statements/:id", delete(delete_statement))
        .route("/statements/:id/sql", post(set_statement_sql_query))
        .route("/statements/:id/prepare", post(prepare_statement))
        .route("/statements/:id/execute", post(execute_statement_query))
        .route(
            "/statements/:id/execute_update",
            post(execute_statement_update),
        )
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

    tracing::info!(
        "Acquired connection '{}' from database '{}'",
        conn_id,
        db_id
    );

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
    id: Path<String>,
    action: impl FnOnce(&mut ManagedConnection) -> Result<(), adbc_core::error::Error>,
    action_name: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    let conn_id = id.0;
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
    path = "/connections/{id}/commit",
    params((
        "id" = String,
        Path,
        description = "Connection ID to commit transaction"
    )),
    responses((
        status = 204,
        description = "Transaction committed"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to commit transaction"))
)]
async fn commit_connection(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(state, id, |conn| conn.commit(), "commit transaction").await
}

#[utoipa::path(
    post,
    path = "/connections/{id}/rollback",
    params((
        "id" = String,
        Path,
        description = "Connection ID to rollback transaction"
    )),
    responses((
        status = 204,
        description = "Transaction rolled back"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to rollback transaction"))
)]
async fn rollback_connection(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(state, id, |conn| conn.rollback(), "rollback transaction").await
}

#[utoipa::path(
    post,
    path = "/connections/{id}/cancel",
    params((
        "id" = String,
        Path,
        description = "Connection ID to cancel current operation"
    )),
    responses((
        status = 204,
        description = "Operation cancelled"
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to cancel operation"))
)]
async fn cancel_connection(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_connection_action(state, id, |conn| conn.cancel(), "cancel operation").await
}
#[utoipa::path(
    post,
    path = "/connections/{id}/statements",
    params((
        "id" = String,
        Path,
        description = "Connection ID to create statement from"
    )),
    responses((
        status = 200,
        description = "Statement created",
        body = CreateStatementResponse
    ), (status = 404, description = "Connection not found"), (status = 500, description = "Failed to create statement"))
)]
async fn create_statement(
    Extension(state): Extension<Arc<AppState>>,
    Path(conn_id): Path<String>,
) -> Result<Json<CreateStatementResponse>, (StatusCode, String)> {
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

    tracing::info!(
        "Created statement '{}' from connection '{}'",
        stmt_id,
        conn_id
    );
    Ok(Json(CreateStatementResponse { id: stmt_id }))
}

#[utoipa::path(
    delete,
    path = "/statements/{id}",
    params((
        "id" = String,
        Path,
        description = "Statement ID to release"
    )),
    responses((
        status = 204,
        description = "Statement released"
    ), (status = 404, description = "Statement not found"))
)]
async fn delete_statement(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
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
    id: Path<String>,
    action: impl FnOnce(&mut ManagedStatement) -> Result<(), adbc_core::error::Error>,
    action_name: &str,
) -> Result<StatusCode, (StatusCode, String)> {
    let stmt_id = id.0;
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
    path = "/statements/{id}/sql",
    params((
        "id" = String,
        Path,
        description = "Statement ID"
    )),
    request_body = SetSqlQueryRequest,
    responses((
        status = 204,
        description = "SQL query set"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to set SQL query"))
)]
async fn set_statement_sql_query(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
    Json(payload): Json<SetSqlQueryRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(
        state,
        id,
        move |stmt| stmt.set_sql_query(&payload.query),
        "set SQL query",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/statements/{id}/prepare",
    params((
        "id" = String,
        Path,
        description = "Statement ID"
    )),
    responses((
        status = 204,
        description = "Statement prepared"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to prepare statement"))
)]
async fn prepare_statement(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(state, id, |stmt| stmt.prepare(), "prepare statement").await
}

#[utoipa::path(
    post,
    path = "/statements/{id}/execute_update",
    params((
        "id" = String,
        Path,
        description = "Statement ID"
    )),
    responses((
        status = 204,
        description = "Update executed"
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to execute update"))
)]
async fn execute_statement_update(
    state: Extension<Arc<AppState>>,
    id: Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    handle_statement_action(
        state,
        id,
        |stmt| stmt.execute_update().map(|_| ()),
        "execute update",
    )
    .await
}

#[utoipa::path(
    post,
    path = "/statements/{id}/execute",
    params((
        "id" = String,
        Path,
        description = "Statement ID"
    )),
    responses((
        status = 200,
        description = "Query executed",
        body = Vec<Value>
    ), (status = 404, description = "Statement not found"), (status = 500, description = "Failed to execute query"))
)]
async fn execute_statement_query(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let stmt_id = id;
    let stmt_entry = state.statement_registry.get(&stmt_id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Statement '{}' not found", stmt_id),
    ))?;

    let mut stmt_guard = stmt_entry.statement.lock().await;

    let reader = stmt_guard.execute().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to execute query: {}", e),
        )
    })?;

    serialize_reader(reader)
}

fn serialize_reader<R: arrow::array::RecordBatchReader>(
    reader: R,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let mut rows = Vec::new();
    for batch in reader {
        let batch = batch.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Arrow error: {}", e),
            )
        })?;
        let mut buf = Vec::new();
        let mut writer = WriterBuilder::new().build::<_, LineDelimited>(&mut buf);
        writer.write(&batch).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("JSON write error: {}", e),
            )
        })?;
        writer.finish().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("JSON finish error: {}", e),
            )
        })?;

        let json_str = String::from_utf8(buf).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("UTF8 error: {}", e),
            )
        })?;
        for line in json_str.lines() {
            if !line.is_empty() {
                let val: serde_json::Value = serde_json::from_str(line).map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("JSON parse error: {}", e),
                    )
                })?;
                rows.push(val);
            }
        }
    }
    Ok(Json(rows))
}

fn serialize_info_reader<R: arrow::array::RecordBatchReader>(
    reader: R,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let mut rows = Vec::new();
    for batch in reader {
        let batch = batch.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Arrow error: {}", e),
            )
        })?;

        let info_codes = batch
            .column(0)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Expected UInt32 for info_code".to_string(),
            ))?;
        let info_values = batch
            .column(1)
            .as_any()
            .downcast_ref::<UnionArray>()
            .ok_or((
                StatusCode::INTERNAL_SERVER_ERROR,
                "Expected Union for info_value".to_string(),
            ))?;

        for i in 0..batch.num_rows() {
            let code = info_codes.value(i);
            let type_id = info_values.type_id(i);
            let value_offset = info_values.value_offset(i);
            let child = info_values.child(type_id);

            // ADBC info_value children (mapped by convention/spec, though dynamic lookup is safer this is a quick fix):
            // 0: string_value (Utf8)
            // 1: bool_value (Boolean)
            // 2: int64_value (Int64)
            // 3: int32_bitmask (Int32)
            // 4: string_list (List<Utf8>) - Not handled
            // 5: int32_to_int32_list_map (Map) - Not handled

            let val = match type_id {
                0 => {
                    // String
                    let arr = child.as_any().downcast_ref::<StringArray>().unwrap();
                    if arr.is_null(value_offset) {
                        serde_json::Value::Null
                    } else {
                        serde_json::Value::String(arr.value(value_offset).to_string())
                    }
                }
                1 => {
                    // Bool
                    let arr = child.as_any().downcast_ref::<BooleanArray>().unwrap();
                    if arr.is_null(value_offset) {
                        serde_json::Value::Null
                    } else {
                        serde_json::Value::Bool(arr.value(value_offset))
                    }
                }
                2 => {
                    // Int64
                    let arr = child.as_any().downcast_ref::<Int64Array>().unwrap();
                    if arr.is_null(value_offset) {
                        serde_json::Value::Null
                    } else {
                        serde_json::json!(arr.value(value_offset))
                    }
                }
                3 => {
                    // Int32
                    let arr = child.as_any().downcast_ref::<Int32Array>().unwrap();
                    if arr.is_null(value_offset) {
                        serde_json::Value::Null
                    } else {
                        serde_json::json!(arr.value(value_offset))
                    }
                }
                _ => serde_json::Value::String(format!("Unsupported Union Variant {}", type_id)),
            };

            rows.push(serde_json::json!({
                "info_name": code,
                "info_value": val
            }));
        }
    }
    Ok(Json(rows))
}

#[utoipa::path(
    get,
    path = "/connections/{id}/info",
    params((
        "id" = String,
        Path,
        description = "Connection ID"
    )),
    responses((
        status = 200,
        description = "Database metadata info",
        body = Vec<Value>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_info(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
    let managed_conn = &mut ***conn_guard;

    // Get all info codes
    let reader = managed_conn.get_info(None).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get info: {}", e),
        )
    })?;

    serialize_info_reader(reader)
}

#[utoipa::path(
    get,
    path = "/connections/{id}/objects",
    params(
        ("id" = String, Path, description = "Connection ID"),
        GetObjectsParams
    ),
    responses((
        status = 200,
        description = "Database objects",
        body = Vec<Value>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_objects(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
    Query(params): Query<GetObjectsParams>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
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

    let reader = managed_conn
        .get_objects(
            depth,
            params.catalog.as_deref(),
            params.db_schema.as_deref(),
            params.table_name.as_deref(),
            table_types_slices,
            params.column_name.as_deref(),
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get objects: {}", e),
            )
        })?;

    serialize_reader(reader)
}

#[utoipa::path(
    get,
    path = "/connections/{id}/table-types",
    params((
        "id" = String,
        Path,
        description = "Connection ID"
    )),
    responses((
        status = 200,
        description = "Table types",
        body = Vec<Value>
    ), (status = 404, description = "Connection not found"))
)]
async fn get_connection_table_types(
    Extension(state): Extension<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let conn_entry = state.connection_registry.get(&id).await.ok_or((
        StatusCode::NOT_FOUND,
        format!("Connection '{}' not found", id),
    ))?;

    let mut conn_guard = conn_entry.connection.lock().await;
    let managed_conn = &mut ***conn_guard;

    let reader = managed_conn.get_table_types().map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get table types: {}", e),
        )
    })?;

    serialize_reader(reader)
}

#[utoipa::path(
    get,
    path = "/connections/{id}/tables/{table_name}/schema",
    params(
        ("id" = String, Path, description = "Connection ID"),
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
    Path((id, table_name)): Path<(String, String)>,
    Query(params): Query<GetTableSchemaParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
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
