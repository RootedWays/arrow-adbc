use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use thiserror::Error;
use tokio::sync::Mutex; // Required for thread-safe mutable access

use adbc_core::{options::AdbcVersion, LOAD_FLAG_SEARCH_USER};
use adbc_driver_manager::ManagedDriver;

#[derive(Error, Debug)]
pub enum DriverRegistryError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ADBC driver error: {0}")]
    Adbc(#[from] adbc_core::error::Error),
    #[error("Environment variable not found: {0}")]
    EnvVarNotFound(String),
    #[error("Platform not supported")]
    #[allow(dead_code)]
    UnsupportedPlatform,
    #[error("Driver name (filename stem) missing or not valid UTF-8 for manifest: {path}")]
    InvalidDriverName { path: PathBuf },
}

pub struct DriverRegistry {
    // Now stores Arc<Mutex<ManagedDriver>>
    drivers: HashMap<String, Arc<Mutex<ManagedDriver>>>,
}

impl DriverRegistry {
    pub fn new() -> Result<Self, DriverRegistryError> {
        let drivers_path = Self::get_drivers_path()?;
        Self::discover_and_load_drivers(&drivers_path)
    }

    /// Attempts to locate the OS-specific default path for ADBC drivers.
    fn get_drivers_path() -> Result<PathBuf, DriverRegistryError> {
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var("HOME")
                .map_err(|_| DriverRegistryError::EnvVarNotFound("HOME".to_string()))?;
            let path = PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("ADBC")
                .join("Drivers");
            Ok(path)
        }
        #[cfg(target_os = "linux")]
        {
            let home = std::env::var("HOME")
                .map_err(|_| DriverRegistryError::EnvVarNotFound("HOME".to_string()))?;
            let path = PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("adbc")
                .join("drivers");
            Ok(path)
        }
        #[cfg(target_os = "windows")]
        {
            let local_app_data = std::env::var("LOCALAPPDATA")
                .map_err(|_| DriverRegistryError::EnvVarNotFound("LOCALAPPDATA".to_string()))?;
            let path = PathBuf::from(local_app_data).join("ADBC").join("Drivers");
            Ok(path)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            Err(DriverRegistryError::UnsupportedPlatform)
        }
    }

    fn discover_and_load_drivers(base_path: &Path) -> Result<Self, DriverRegistryError> {
        let mut drivers = HashMap::new();
        tracing::info!("Scanning for ADBC drivers in: {:?}", base_path);

        if !base_path.exists() {
            tracing::warn!("ADBC drivers path does not exist: {:?}", base_path);
            return Ok(Self { drivers });
        }

        for entry in fs::read_dir(base_path)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "toml") {
                tracing::debug!("Found potential driver manifest: {:?}", path);

                let driver_file_stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| DriverRegistryError::InvalidDriverName { path: path.clone() })?
                    .to_string();

                // Let ManagedDriver::load_from_name handle reading the TOML and
                // resolving the shared library path and entrypoint.
                match ManagedDriver::load_from_name(
                    &driver_file_stem,
                    None, // entrypoint will be read from TOML by manager
                    AdbcVersion::V110,
                    LOAD_FLAG_SEARCH_USER,
                    None, // additional_search_paths
                ) {
                    Ok(driver_manager) => {
                        drivers.insert(
                            driver_file_stem.clone(),
                            Arc::new(Mutex::new(driver_manager)),
                        );
                        tracing::info!("Driver '{}' loaded and registered.", driver_file_stem);
                    }
                    Err(e) => {
                        tracing::error!("Failed to load driver '{}': {}", driver_file_stem, e);
                        // Continue to try and load other drivers
                    }
                }
            }
        }

        if drivers.is_empty() {
            tracing::warn!("No ADBC drivers found in {:?}", base_path);
        }

        Ok(Self { drivers })
    }

    // get_driver now returns a reference to Arc<Mutex<ManagedDriver>>
    pub fn get_driver(&self, name: &str) -> Option<&Arc<Mutex<ManagedDriver>>> {
        self.drivers.get(name)
    }

    pub fn list_drivers(&self) -> Vec<String> {
        self.drivers.keys().cloned().collect()
    }
}
