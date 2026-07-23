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
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

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
struct HttpResult {
    status: u16,
    body: String,
}

#[tauri::command]
async fn http_get(url: String, timeout_ms: Option<u64>) -> Result<HttpResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(3000)))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .get(&url)
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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(120_000)))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let response = client
        .post(&url)
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

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_data_dir,
            read_text_file,
            write_text_file,
            write_binary_file,
            http_get,
            http_post,
            ollama_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
