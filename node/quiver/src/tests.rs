use super::*;
use std::fs;
use std::path::PathBuf;
use utoipa::OpenApi;

#[test]
fn generate_openapi_spec() {
    let spec = ApiDoc::openapi().to_pretty_json().unwrap();
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("openapi.json");
    fs::write(&path, spec).expect("Failed to write openapi.json");
    println!("OpenAPI spec written to {:?}", path);
}
