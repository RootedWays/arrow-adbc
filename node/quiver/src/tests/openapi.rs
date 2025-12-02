use crate::ApiDoc;
use utoipa::OpenApi;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

#[test]
fn generate_openapi_spec() {
    let spec = ApiDoc::openapi();
    let json = spec.to_pretty_json().expect("Failed to convert OpenAPI spec to JSON");
    
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let path = PathBuf::from(manifest_dir).join("openapi.json");
    
    let mut file = File::create(&path).expect("Failed to create openapi.json");
    file.write_all(json.as_bytes()).expect("Failed to write to openapi.json");
}
