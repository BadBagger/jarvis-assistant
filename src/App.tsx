import { useEffect, useState } from "react";
import "./App.css";
import { ChatPage } from "./chat/ChatPage";
import { SettingsPage } from "./settings/SettingsPage";
import { loadSettings } from "./shared/persistence";
import type { Settings } from "./shared/types";

type View = "chat" | "settings";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>("chat");

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  if (!settings) {
    return <div className="app-loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Jarvis</h1>
        <nav>
          <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
            Chat
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
      </header>
      <main className="app-main">
        {view === "chat" ? <ChatPage settings={settings} /> : <SettingsPage settings={settings} onSaved={setSettings} />}
      </main>
    </div>
  );
}

export default App;
