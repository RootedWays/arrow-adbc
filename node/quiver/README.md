# Quiver: Rust ADBC Gateway Prototype

Quiver is an example prototype of an Arrow-native gateway for ADBC (Arrow Database Connectivity) drivers, implemented in Rust. It exposes a RESTful API to interact with various databases (PostgreSQL, DuckDB, SQLite, etc.) using the Arrow IPC format for efficient data transfer.

## Key Features

*   **Unified API:** Interact with different databases using a single, consistent REST API.
*   **Arrow Native:** Built on Apache Arrow and ADBC for zero-copy data handling where possible and efficient IPC streaming.
*   **Connection Pooling:** Built-in connection pooling for performance.
*   **Stateless/Stateful Hybrid:**  Manages Driver -> Database -> Connection -> Statement hierarchy with token-based access.
*   **Swagger UI:** Integrated Swagger/OpenAPI documentation.

## Prerequisites

*   Rust (latest stable)
*   Docker (optional, for running database containers)
*   ADBC Drivers: You need the shared libraries for the drivers you wish to use (e.g., `libadbc_driver_postgresql.so`, `libadbc_driver_duckdb.dylib`) placed in the appropriate directory for your OS.

## Running the Application

1.  **Build and Run:**
    ```bash
    cargo run
    ```
    The server listens on port `8080` by default.

2.  **Run with Docker Compose (for PostgreSQL demo):**
    ```bash
    docker compose up -d
    cargo run
    ```

3.  **Check Health:**
    ```bash
    curl http://localhost:8080/health
    ```

## API Documentation

Once running, visit **http://localhost:8080/swagger-ui/** to explore the interactive API documentation.

### Core Workflows

1.  **List Drivers:** `GET /drivers` - See available ADBC drivers.
2.  **Create Database:** `POST /databases`
    *   Payload: `{ "driver": "postgresql", "options": { "uri": "..." }, "name": "my_db" }`
    *   Returns: `id`
3.  **Get Connection:** `POST /databases/{id}/connections`
    *   Returns: `token` (Bearer token for subsequent calls)
4.  **Execute Query:** `POST /connections/query`
    *   Header: `Authorization: Bearer <token>`
    *   Payload: `{ "query": "SELECT * FROM my_table" }`
    *   Response: Arrow IPC Stream

## Development

*   **Run Tests:** `cargo test` (This command also generates the OpenAPI specification file `openapi.json`.)
*   **Lint:** `cargo clippy`
*   **Format:** `cargo fmt`

## Project Structure

*   `src/main.rs`: Entry point and API route definitions.
*   `src/driver_manager.rs`: Loads and manages ADBC driver shared libraries.
*   `src/database_manager.rs`: Manages database instances and connection pools.
*   `src/connection_manager.rs`: Handles active connection sessions.
*   `src/statement_manager.rs`: Manages prepared statements.
*   `src/auth.rs`: JWT handling for resource access.
