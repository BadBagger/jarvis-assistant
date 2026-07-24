import { useEffect, useState } from "react";
import "./App.css";
import { ChatPage } from "./chat/ChatPage";
import { MemoryPage } from "./memory/MemoryPage";
import { PlanningPage } from "./planning/PlanningPage";
import { SettingsPage } from "./settings/SettingsPage";
import { loadSettings } from "./shared/persistence";
import type { Settings } from "./shared/types";
import { AssistantWorkspace } from "./workspace/AssistantWorkspace";

type View = "workspace" | "chat" | "plans" | "memory" | "settings";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>("workspace");

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
          <button className={view === "workspace" ? "active" : ""} onClick={() => setView("workspace")}>
            Workspace
          </button>
          <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
            Chat
          </button>
          <button className={view === "plans" ? "active" : ""} onClick={() => setView("plans")}>
            Plans
          </button>
          <button className={view === "memory" ? "active" : ""} onClick={() => setView("memory")}>
            Memory
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
      </header>
      <main className="app-main">
        {view === "workspace" && <AssistantWorkspace settings={settings} onOpenView={setView} />}
        {view === "chat" && <ChatPage settings={settings} />}
        {view === "plans" && <PlanningPage />}
        {view === "memory" && <MemoryPage />}
        {view === "settings" && <SettingsPage settings={settings} onSaved={setSettings} />}
      </main>
    </div>
  );
}

export default App;
