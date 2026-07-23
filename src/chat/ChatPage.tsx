import { useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { buildDocxBase64 } from "../documents/generateDocx";
import { generateImage } from "../imagegen/client";
import { dataUrlToBase64, streamOllamaChat, type OllamaChatMessage } from "../ollama/client";
import type { ChatMessage, Settings } from "../shared/types";

interface Props {
  settings: Settings;
}

const IMAGINE_PREFIX = "/imagine ";

export function ChatPage({ settings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateMessage(id: string, patch: Partial<ChatMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function historyForOllama(): OllamaChatMessage[] {
    return messages
      .filter((m) => m.kind === "text" || m.kind === "image-scan")
      .map((m) => ({ role: m.role, content: m.content }));
  }

  async function handleAttachImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setAttachedImage({ dataUrl });
    e.target.value = "";
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && !attachedImage) return;
    setError(null);
    setInput("");
    const image = attachedImage;
    setAttachedImage(null);

    if (image) {
      await handleImageScan(text, image.dataUrl);
    } else if (text.startsWith(IMAGINE_PREFIX)) {
      await handleImageGen(text.slice(IMAGINE_PREFIX.length).trim());
    } else {
      await handleTextChat(text);
    }
  }

  async function handleTextChat(text: string) {
    const history = historyForOllama();
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", kind: "text", content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", kind: "text", content: "", pending: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);
    try {
      await streamOllamaChat(settings.ollamaBaseUrl, settings.chatModel, [...history, { role: "user", content: text }], (delta) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
      });
      updateMessage(assistantId, { pending: false });
    } catch (err) {
      updateMessage(assistantId, {
        pending: false,
        kind: "error",
        content: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleImageScan(text: string, dataUrl: string) {
    const prompt = text || "Describe what's in this image in detail.";
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "image-scan",
      content: prompt,
      attachedImageDataUrl: dataUrl,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", kind: "text", content: "", pending: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);
    try {
      await streamOllamaChat(
        settings.ollamaBaseUrl,
        settings.visionModel,
        [{ role: "user", content: prompt, images: [dataUrlToBase64(dataUrl)] }],
        (delta) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
        },
      );
      updateMessage(assistantId, { pending: false });
    } catch (err) {
      updateMessage(assistantId, {
        pending: false,
        kind: "error",
        content: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleImageGen(prompt: string) {
    if (!prompt) {
      setError("Usage: /imagine <description of the image you want>");
      return;
    }
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", kind: "text", content: `/imagine ${prompt}` };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      kind: "image-gen",
      content: prompt,
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setBusy(true);
    try {
      const base64 = await generateImage(settings.imageGenBaseUrl, prompt);
      updateMessage(assistantId, { pending: false, generatedImageBase64: base64 });
    } catch (err) {
      updateMessage(assistantId, {
        pending: false,
        kind: "error",
        content: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDocument(message: ChatMessage) {
    try {
      const base64 = await buildDocxBase64("Jarvis note", message.content);
      const path = `${settings.outputDir}/jarvis-note-${Date.now()}.docx`;
      await invoke("write_binary_file", { path, base64Data: base64 });
      updateMessage(message.id, { savedTo: path });
    } catch (err) {
      updateMessage(message.id, { savedTo: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  async function handleSaveImage(message: ChatMessage) {
    if (!message.generatedImageBase64) return;
    try {
      const path = `${settings.outputDir}/jarvis-image-${Date.now()}.png`;
      await invoke("write_binary_file", { path, base64Data: message.generatedImageBase64 });
      updateMessage(message.id, { savedTo: path });
    } catch (err) {
      updateMessage(message.id, { savedTo: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return (
    <div className="chat-page">
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty-state">
            Say something, attach an image (📎) to have it scanned/described, or type{" "}
            <code>/imagine a description</code> to generate one.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message chat-message--${m.role} chat-message--${m.kind}`}>
            {m.attachedImageDataUrl && <img className="chat-message__image" src={m.attachedImageDataUrl} alt="attached" />}
            {m.kind === "image-gen" && m.generatedImageBase64 && (
              <img className="chat-message__image" src={`data:image/png;base64,${m.generatedImageBase64}`} alt={m.content} />
            )}
            <p className="chat-message__content">
              {m.content}
              {m.pending && <span className="chat-message__cursor">▍</span>}
            </p>
            {m.role === "assistant" && m.kind === "text" && !m.pending && (
              <button className="chat-message__action" onClick={() => void handleSaveDocument(m)}>
                Save as document
              </button>
            )}
            {m.role === "assistant" && m.kind === "image-gen" && m.generatedImageBase64 && (
              <button className="chat-message__action" onClick={() => void handleSaveImage(m)}>
                Save image
              </button>
            )}
            {m.savedTo && <p className="chat-message__saved">Saved to {m.savedTo}</p>}
          </div>
        ))}
      </div>

      {error && <p className="chat-error">{error}</p>}
      {attachedImage && (
        <div className="chat-attachment-preview">
          <img src={attachedImage.dataUrl} alt="attachment preview" />
          <button onClick={() => setAttachedImage(null)}>Remove</button>
        </div>
      )}

      <div className="chat-input-row">
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void handleAttachImage(e)} />
        <button onClick={() => fileInputRef.current?.click()} disabled={busy} title="Attach an image to scan">
          📎
        </button>
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={attachedImage ? "Ask something about this image (optional)..." : "Message Jarvis, or /imagine ..."}
          disabled={busy}
        />
        <button onClick={() => void handleSend()} disabled={busy || (!input.trim() && !attachedImage)}>
          Send
        </button>
      </div>
    </div>
  );
}
