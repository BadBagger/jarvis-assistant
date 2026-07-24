// Tauri backend commands for Jarvis Assistant.
//
// Everything here is local-only: this app never binds a listening port and
// never talks to anything but 127.0.0.1/localhost services the user points
// it at in Settings (an Ollama server for chat/vision, a Stable Diffusion
// WebUI-compatible server for image generation). HTTP calls run in Rust
// rather than the webview's fetch() to avoid CORS -- local dev servers like
// Ollama and A1111 don't send Access-Control-Allow-Origin headers, and
// Rust's HTTP client isn't subject to that browser restriction anyway.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager};

fn parse_local_http_url(label: &str, value: &str) -> Result<Url, String> {
    let parsed = Url::parse(value.trim()).map_err(|e| format!("{label} must be a valid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err(format!("{label} must start with http:// or https://")),
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| format!("{label} must include a host"))?
        .to_ascii_lowercase();
    let is_localhost = host == "localhost" || host == "::1" || host == "[::1]" || host.starts_with("127.");
    if !is_localhost {
        return Err(format!(
            "{label} must point to localhost, 127.0.0.1, or [::1]; got {host}"
        ));
    }

    Ok(parsed)
}

#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create app data dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create dir for {path}: {e}"))?;
    }
    fs::write(&p, contents).map_err(|e| format!("failed to write {path}: {e}"))
}

/// Writes base64-encoded bytes to disk -- used for generated images (PNG
/// bytes back from the image-gen API) and generated .docx files (built in
/// JS via the `docx` package, which produces bytes the webview can't write
/// directly to an arbitrary path).
#[tauri::command]
fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(base64_data)
        .map_err(|e| format!("invalid base64 data: {e}"))?;
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create dir for {path}: {e}"))?;
    }
    fs::write(&p, bytes).map_err(|e| format!("failed to write {path}: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    path: String,
    is_dir: bool,
    size_bytes: Option<u64>,
    modified_ms: Option<u128>,
}

#[tauri::command]
fn list_directory(path: String, limit: Option<usize>) -> Result<Vec<DirectoryEntry>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(Vec::new());
    }
    if !p.is_dir() {
        return Err(format!("{path} is not a directory"));
    }

    let limit = limit.unwrap_or(100).min(500);
    let mut entries = Vec::new();

    for entry in fs::read_dir(&p).map_err(|e| format!("failed to list {path}: {e}"))?.take(limit) {
        let entry = entry.map_err(|e| format!("failed to read directory entry in {path}: {e}"))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("failed to read metadata for {:?}: {e}", entry.path()))?;
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());

        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size_bytes: if metadata.is_file() { Some(metadata.len()) } else { None },
            modified_ms,
        });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[derive(Serialize)]
struct HttpResult {
    status: u16,
    body: String,
}

#[tauri::command]
async fn http_get(url: String, timeout_ms: Option<u64>) -> Result<HttpResult, String> {
    let url = parse_local_http_url("URL", &url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(3000)))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read response body from {url}: {e}"))?;

    Ok(HttpResult { status, body })
}

/// Generic local JSON POST -- used for the image-gen API (A1111/ComfyUI
/// style `/sdapi/v1/txt2img` endpoints) and anything else that just needs a
/// one-shot request/response with no streaming.
#[tauri::command]
async fn http_post(url: String, body_json: String, timeout_ms: Option<u64>) -> Result<HttpResult, String> {
    let url = parse_local_http_url("URL", &url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(120_000)))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .post(url.clone())
        .header("Content-Type", "application/json")
        .body(body_json)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("failed to read response body from {url}: {e}"))?;

    Ok(HttpResult { status, body })
}

// ---------------------------------------------------------------------------
// Ollama chat/vision -- POSTs to `${base_url}/api/chat` with stream:true and
// reads Ollama's newline-delimited JSON response (one complete JSON object
// per line, NOT Server-Sent Events -- no "data: " prefix). Each line carries
// an incremental `message.content` delta plus a `done` flag. Chunks are
// emitted as "jarvis:chat-chunk" events tagged with the caller's request_id
// so the frontend can tell concurrent/stale requests apart; the full
// accumulated reply is also returned directly once the stream ends, so a
// caller that doesn't care about incremental deltas can just await it.
//
// Vision (image scanning) reuses this exact command: Ollama's vision models
// (e.g. llava) take images as base64 strings on a message's `images` field,
// no separate endpoint needed.
#[derive(Serialize, Deserialize, Clone)]
struct OllamaMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}

#[derive(Serialize)]
struct OllamaChatRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaChatLine {
    #[serde(default)]
    message: Option<OllamaMessageDelta>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct OllamaMessageDelta {
    #[serde(default)]
    content: String,
}

#[derive(Clone, Serialize)]
struct ChatChunkPayload {
    request_id: String,
    content: String,
    done: bool,
    error: Option<String>,
}

#[tauri::command]
async fn ollama_chat(
    app: tauri::AppHandle,
    base_url: String,
    model: String,
    messages: Vec<OllamaMessage>,
    request_id: String,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let mut url = parse_local_http_url("Ollama base URL", &base_url)?;
    url.set_path(&format!("{}/api/chat", url.path().trim_end_matches('/')));
    url.set_query(None);
    url.set_fragment(None);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .post(url.clone())
        .json(&OllamaChatRequest {
            model,
            messages,
            stream: true,
        })
        .send()
        .await
        .map_err(|e| format!("could not reach Ollama at {url}: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama responded with HTTP {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_reply = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buffer.find('\n') {
            let line: String = buffer.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parsed: OllamaChatLine = match serde_json::from_str(line) {
                Ok(p) => p,
                Err(_) => continue, // ignore malformed/partial lines
            };

            if let Some(err) = &parsed.error {
                let _ = app.emit(
                    "jarvis:chat-chunk",
                    ChatChunkPayload {
                        request_id: request_id.clone(),
                        content: String::new(),
                        done: true,
                        error: Some(err.clone()),
                    },
                );
                return Err(err.clone());
            }

            let delta = parsed.message.map(|m| m.content).unwrap_or_default();
            if !delta.is_empty() {
                full_reply.push_str(&delta);
            }

            let _ = app.emit(
                "jarvis:chat-chunk",
                ChatChunkPayload {
                    request_id: request_id.clone(),
                    content: delta,
                    done: parsed.done,
                    error: None,
                },
            );
        }
    }

    Ok(full_reply)
}

#[cfg(test)]
mod tests {
    use super::parse_local_http_url;

    #[test]
    fn accepts_local_service_urls() {
        assert!(parse_local_http_url("URL", "http://localhost:11434/api/tags").is_ok());
        assert!(parse_local_http_url("URL", "http://127.0.0.1:7860/sdapi/v1/options").is_ok());
        assert!(parse_local_http_url("URL", "http://127.1.2.3:7860").is_ok());
        assert!(parse_local_http_url("URL", "http://[::1]:11434").is_ok());
    }

    #[test]
    fn rejects_remote_or_non_http_urls() {
        assert!(parse_local_http_url("URL", "https://example.com").is_err());
        assert!(parse_local_http_url("URL", "http://192.168.1.10:11434").is_err());
        assert!(parse_local_http_url("URL", "file:///tmp/model").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_data_dir,
            read_text_file,
            write_text_file,
            write_binary_file,
            list_directory,
            http_get,
            http_post,
            ollama_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
