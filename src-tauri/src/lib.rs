use std::path::PathBuf;
use tauri::Manager;

const SCHEMA_SQL: &str = include_str!("../../traildepot/migrations/main/U1741826400__timekeeper_schema.sql");
const CONFIG_TEXTPROTO: &str = include_str!("../../traildepot/config.textproto");

fn setup_data_dir(data_dir: &PathBuf) {
    let migrations_dir = data_dir.join("migrations/main");
    if !migrations_dir.exists() {
        std::fs::create_dir_all(&migrations_dir).expect("Failed to create migrations dir");
        std::fs::write(
            migrations_dir.join("U20260313000001__timekeeper_schema.sql"),
            SCHEMA_SQL,
        )
        .expect("Failed to write migration");
    }

    let config_path = data_dir.join("config.textproto");
    if !config_path.exists() {
        std::fs::write(&config_path, CONFIG_TEXTPROTO).expect("Failed to write config");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let is_dev = cfg!(debug_assertions);

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir")
                .join("traildepot");

            setup_data_dir(&data_dir);

            // Resolve the TrailBase binary path
            let binary_path = app
                .path()
                .resolve("binaries/trail", tauri::path::BaseDirectory::Resource)
                .expect("Failed to resolve trail binary");

            // Build trail run arguments
            let mut args = vec![
                "run".to_string(),
                "--data-dir".to_string(),
                data_dir.to_str().unwrap().to_string(),
            ];

            if is_dev {
                args.push("--dev".to_string());
                args.push("--admin-address".to_string());
                args.push("localhost:4001".to_string());
            } else {
                // In production, serve the built React app from TrailBase
                let dist_dir = app
                    .path()
                    .resolve("frontend/dist", tauri::path::BaseDirectory::Resource)
                    .expect("Failed to resolve frontend dist");
                args.push("--public-dir".to_string());
                args.push(dist_dir.to_str().unwrap().to_string());
                args.push("--spa".to_string());
            }

            // Spawn TrailBase as a background process
            std::process::Command::new(&binary_path)
                .args(&args)
                .spawn()
                .expect("Failed to spawn TrailBase");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running Timekeeper");
}
