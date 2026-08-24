use std::path::PathBuf;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_shell::ShellExt;

const SCHEMA_SQL: &str = include_str!("../../traildepot/migrations/main/U1741826400__timekeeper_schema.sql");
const INVOICES_SQL: &str = include_str!("../../traildepot/migrations/main/U1741900000__invoices.sql");
const FIX_INVOICE_VIEW_SQL: &str = include_str!("../../traildepot/migrations/main/U1741900001__fix_invoice_view.sql");
const ENTRY_SOURCE_TRACKING_SQL: &str = include_str!("../../traildepot/migrations/main/U1741900002__entry_source_tracking.sql");
const CONFIG_TEXTPROTO: &str = include_str!("../../traildepot/config.textproto");
const TRAY_ICON: &[u8] = include_bytes!("../icons/icon.png");

const SPACES_TEMPLATE: &str = r#"# DigitalOcean Spaces backup configuration
# Fill in your credentials and restart the app.
access_key = "YOUR_ACCESS_KEY"
secret_key = "YOUR_SECRET_KEY"
region     = "nyc3"
bucket     = "timekeeper-backups"
endpoint   = "https://nyc3.digitaloceanspaces.com"
"#;

const GOOGLE_OAUTH_TEMPLATE: &str = r#"# Google Calendar OAuth configuration
# Create a Google desktop OAuth client and fill in your credentials.
client_id = "YOUR_GOOGLE_CLIENT_ID"
client_secret = "YOUR_GOOGLE_CLIENT_SECRET"
"#;

#[derive(serde::Deserialize)]
struct SpacesConfig {
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    endpoint: String,
}

#[derive(serde::Deserialize)]
struct GoogleOAuthConfig {
    client_id: String,
    client_secret: String,
}

fn setup_data_dir(data_dir: &PathBuf) {
    let migrations_dir = data_dir.join("migrations/main");
    std::fs::create_dir_all(&migrations_dir).expect("Failed to create migrations dir");

    // Write each migration only if missing (TrailBase tracks which ran)
    let v1 = migrations_dir.join("U1741826400__timekeeper_schema.sql");
    if !v1.exists() {
        std::fs::write(&v1, SCHEMA_SQL).expect("Failed to write schema migration");
    }
    let v2 = migrations_dir.join("U1741900000__invoices.sql");
    if !v2.exists() {
        std::fs::write(&v2, INVOICES_SQL).expect("Failed to write invoices migration");
    }
    let v3 = migrations_dir.join("U1741900001__fix_invoice_view.sql");
    if !v3.exists() {
        std::fs::write(&v3, FIX_INVOICE_VIEW_SQL).expect("Failed to write fix_invoice_view migration");
    }
    let v4 = migrations_dir.join("U1741900002__entry_source_tracking.sql");
    if !v4.exists() {
        std::fs::write(&v4, ENTRY_SOURCE_TRACKING_SQL).expect("Failed to write entry_source_tracking migration");
    }

    // Always overwrite config so new record_apis are registered on next restart
    let config_path = data_dir.join("config.textproto");
    std::fs::write(&config_path, CONFIG_TEXTPROTO).expect("Failed to write config");
}

fn build_tray_menu(app: &AppHandle, running: bool, paused: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle_label = if running && !paused { "⏸  Pause" } else { "▶  Resume" };
    let toggle_enabled = running || paused;
    let toggle = MenuItem::with_id(app, "toggle", toggle_label, toggle_enabled, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "⏹  Stop", running || paused, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Show Timekeeper", true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit"))?;
    Menu::with_items(app, &[&toggle, &stop, &sep, &show, &quit])
}

#[tauri::command]
fn update_tray_title(
    app: AppHandle,
    client: String,
    elapsed: String,
    running: bool,
    paused: bool,
) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let title = if running || paused {
            let icon = if paused { "⏸" } else { "⏱" };
            format!("{}  {}  {}", client, elapsed, icon)
        } else {
            String::new()
        };
        tray.set_title(Some(&title))?;
    }
    Ok(())
}

#[tauri::command]
fn update_tray_menu(app: AppHandle, running: bool, paused: bool) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let menu = build_tray_menu(&app, running, paused)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

#[tauri::command]
fn open_print_preview(app: AppHandle, html: String) -> Result<(), String> {
    let tmp = std::env::temp_dir().join("timekeeper_invoice.html");
    std::fs::write(&tmp, html).map_err(|e| e.to_string())?;
    app.shell()
        .open(tmp.to_str().unwrap(), None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_google_oauth_config(app_data_dir: &PathBuf) -> Result<GoogleOAuthConfig, String> {
    let config_path = app_data_dir.join("google_oauth.toml");

    if !config_path.exists() {
        std::fs::write(&config_path, GOOGLE_OAUTH_TEMPLATE)
            .map_err(|e| format!("Failed to create google_oauth.toml: {e}"))?;
        return Err(format!(
            "Created {}. Fill in your Google OAuth client credentials and try again.",
            config_path.display()
        ));
    }

    let config_str = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read google_oauth.toml: {e}"))?;
    let cfg: GoogleOAuthConfig = toml::from_str(&config_str)
        .map_err(|e| format!("Invalid google_oauth.toml: {e}"))?;

    if cfg.client_id == "YOUR_GOOGLE_CLIENT_ID" || cfg.client_secret == "YOUR_GOOGLE_CLIENT_SECRET" {
        return Err(format!(
            "Update {} with your Google OAuth client credentials and try again.",
            config_path.display()
        ));
    }

    Ok(cfg)
}

#[tauri::command]
async fn google_auth_start(app: AppHandle) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let google_oauth = load_google_oauth_config(&app_data_dir)?;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let scope = "https://www.googleapis.com/auth/calendar.readonly";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/auth\
         ?client_id={client_id}\
         &redirect_uri={redirect_uri_enc}\
         &response_type=code\
         &scope={scope_enc}\
         &access_type=offline\
         &prompt=consent",
        client_id = google_oauth.client_id,
        redirect_uri_enc = urlencoding::encode(&redirect_uri),
        scope_enc = urlencoding::encode(scope),
    );

    app.shell().open(&auth_url, None).map_err(|e| e.to_string())?;

    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let code = request
        .lines()
        .next()
        .and_then(|line| line.split_once('?').map(|(_, qs)| qs))
        .and_then(|qs| qs.split('&').find(|p| p.starts_with("code=")))
        .map(|p| p.trim_start_matches("code=").split_once(' ').map(|(c, _)| c).unwrap_or(p.trim_start_matches("code=")))
        .ok_or("No code in OAuth callback")?
        .to_string();

    let html = "<html><body style='font-family:sans-serif;padding:40px'>\
        <h2>&#10003; Connected to Google Calendar</h2>\
        <p>You can close this tab and return to Timekeeper.</p>\
        </body></html>";
    let _ = stream
        .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n{html}").as_bytes())
        .await;

    let resp: serde_json::Value = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", google_oauth.client_id.as_str()),
            ("client_secret", google_oauth.client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    resp["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Token exchange failed: {resp}"))
}

#[tauri::command]
async fn google_fetch_events(
    access_token: String,
    time_min: String,
    time_max: String,
) -> Result<serde_json::Value, String> {
    let resp: serde_json::Value = reqwest::Client::new()
        .get("https://www.googleapis.com/calendar/v3/calendars/primary/events")
        .bearer_auth(&access_token)
        .query(&[
            ("timeMin", time_min.as_str()),
            ("timeMax", time_max.as_str()),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", "500"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp)
}

async fn run_backup(app_data_dir: PathBuf) {
    let config_path = app_data_dir.join("spaces.toml");

    if !config_path.exists() {
        let _ = std::fs::write(&config_path, SPACES_TEMPLATE);
        eprintln!("[Backup] Created spaces.toml — fill in credentials to enable backups");
        return;
    }

    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) => { eprintln!("[Backup] Failed to read spaces.toml: {e}"); return; }
    };

    let cfg: SpacesConfig = match toml::from_str(&config_str) {
        Ok(c) => c,
        Err(e) => { eprintln!("[Backup] Invalid spaces.toml: {e}"); return; }
    };

    if cfg.access_key == "YOUR_ACCESS_KEY" {
        eprintln!("[Backup] spaces.toml not configured yet, skipping backup");
        return;
    }

    let db_path = app_data_dir.join("traildepot/data/main.db");
    let db_bytes = match std::fs::read(&db_path) {
        Ok(b) => b,
        Err(e) => { eprintln!("[Backup] Failed to read DB: {e}"); return; }
    };

    use aws_sdk_s3::Client;
    use aws_sdk_s3::config::{Credentials, Region};
    use aws_sdk_s3::primitives::ByteStream;

    let credentials = Credentials::new(&cfg.access_key, &cfg.secret_key, None, None, "timekeeper");
    let s3_config = aws_sdk_s3::config::Builder::new()
        .credentials_provider(credentials)
        .region(Region::new(cfg.region.clone()))
        .endpoint_url(&cfg.endpoint)
        .force_path_style(true)
        .build();
    let client = Client::from_conf(s3_config);

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let key = format!("backups/timekeeper_{timestamp}.db");

    match client
        .put_object()
        .bucket(&cfg.bucket)
        .key(&key)
        .body(ByteStream::from(db_bytes))
        .send()
        .await
    {
        Ok(_) => eprintln!("[Backup] Uploaded: {key}"),
        Err(e) => { eprintln!("[Backup] Upload failed: {e}"); return; }
    }

    let cleanup_marker = app_data_dir.join("last_cleanup");
    let should_cleanup = match std::fs::metadata(&cleanup_marker) {
        Ok(meta) => meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs() > 7 * 24 * 3600)
            .unwrap_or(true),
        Err(_) => true,
    };

    if should_cleanup {
        cleanup_old_backups(&client, &cfg.bucket).await;
        let _ = std::fs::write(&cleanup_marker, chrono::Utc::now().to_rfc3339());
    }
}

async fn cleanup_old_backups(client: &aws_sdk_s3::Client, bucket: &str) {
    let cutoff = chrono::Utc::now() - chrono::TimeDelta::days(7);

    let resp = match client
        .list_objects_v2()
        .bucket(bucket)
        .prefix("backups/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => { eprintln!("[Backup] Cleanup list failed: {e}"); return; }
    };

    for obj in resp.contents().iter() {
        let last_modified = obj
            .last_modified()
            .and_then(|dt| chrono::DateTime::from_timestamp(dt.secs(), 0));

        if let Some(modified) = last_modified {
            if modified < cutoff {
                let key = obj.key().unwrap_or_default();
                match client.delete_object().bucket(bucket).key(key).send().await {
                    Ok(_) => eprintln!("[Backup] Deleted old backup: {key}"),
                    Err(e) => eprintln!("[Backup] Failed to delete {key}: {e}"),
                }
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![update_tray_title, update_tray_menu, google_auth_start, google_fetch_events, open_print_preview])
        .setup(|app| {
            let is_dev = cfg!(debug_assertions);

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let data_dir = app_data_dir.join("traildepot");

            setup_data_dir(&data_dir);

            // Backup before TrailBase opens the DB
            let backup_dir = app_data_dir.clone();
            tauri::async_runtime::spawn(async move {
                run_backup(backup_dir).await;
            });

            // Only spawn trail if our port 47400 is not already in use
            let trail_already_running = std::net::TcpStream::connect_timeout(
                &"127.0.0.1:47400".parse().unwrap(),
                std::time::Duration::from_millis(200),
            ).is_ok();

            if trail_already_running {
                eprintln!("[TrailBase] Port 47400 already in use — skipping spawn to avoid duplicate");
            } else {
                // Build trail run arguments
                let mut args = vec!["run".to_string(), "--address".to_string(), "localhost:47400".to_string()];
                if is_dev {
                    args.push("--dev".to_string());
                    args.push("--admin-address".to_string());
                    args.push("localhost:47401".to_string());
                } else {
                    let dist_dir = app
                        .path()
                        .resolve("frontend/dist", tauri::path::BaseDirectory::Resource)
                        .expect("Failed to resolve frontend dist");
                    args.push("--public-dir".to_string());
                    args.push(dist_dir.to_str().unwrap().to_string());
                    args.push("--spa".to_string());
                }

                let (_rx, child) = app.shell()
                    .sidecar("trail")
                    .expect("Failed to create trail sidecar")
                    .current_dir(&app_data_dir)
                    .args(&args)
                    .spawn()
                    .expect("Failed to spawn TrailBase");
                std::mem::forget(child);
            }

            // Set up menu bar tray
            let menu = build_tray_menu(app.handle(), false, false)?;
            let icon = Image::from_bytes(TRAY_ICON)?;

            let app_handle = app.handle().clone();
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .menu(&menu)
                .on_menu_event(move |_tray, event| {
                    match event.id.as_ref() {
                        "toggle" => { let _ = app_handle.emit("tray-action", "toggle"); }
                        "stop"   => { let _ = app_handle.emit("tray-action", "stop"); }
                        "show"   => {
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Hide to tray on window close instead of quitting
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running Timekeeper");
}
