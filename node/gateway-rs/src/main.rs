use axum::{
    routing::get,
    Router,
};
use std::net::SocketAddr;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Path to the ADBC driver (shared library)
    #[arg(long, env = "ADBC_DRIVER_PATH")]
    driver_path: String,

    /// Entrypoint for the ADBC driver
    #[arg(long, env = "ADBC_ENTRYPOINT", default_value = "AdbcDriverInit")]
    driver_entrypoint: String,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "gateway_rs=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let args = Args::parse();

    tracing::info!("Starting ADBC Gateway on port {}", args.port);
    tracing::info!("Loading Driver: {}", args.driver_path);
    tracing::info!("Entrypoint: {}", args.driver_entrypoint);

    // Build our application with a single route
    let app = Router::new()
        .route("/health", get(|| async { "OK" }));

    // Run it
    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}