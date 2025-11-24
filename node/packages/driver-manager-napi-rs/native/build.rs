fn main() {
    // On macOS, allow unresolved N-API symbols to be resolved at load time.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-undefined");
        println!("cargo:rustc-link-arg=dynamic_lookup");
    }
}
