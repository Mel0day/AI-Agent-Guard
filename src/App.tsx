import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import LogWindow from "./pages/LogWindow";
import SetupWizard from "./pages/SetupWizard";
import ConfirmDialog from "./components/ConfirmDialog";
import type { WarnEventPayload } from "./types";

type ActiveView = "main" | "setup";

export default function App() {
  const [view, setView] = useState<ActiveView>("main");
  const [pendingWarn, setPendingWarn] = useState<WarnEventPayload | null>(null);

  useEffect(() => {
    // Listen for setup wizard trigger from Rust
    const unlistenSetup = listen<void>("show_setup_wizard", () => {
      setView("setup");
    });

    // Listen for WARN events requiring user confirmation
    const unlistenWarn = listen<WarnEventPayload>("warn_event", (evt) => {
      setPendingWarn(evt.payload);
    });

    return () => {
      unlistenSetup.then((f) => f());
      unlistenWarn.then((f) => f());
    };
  }, []);

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100">
      {view === "setup" ? (
        <SetupWizard onComplete={() => setView("main")} />
      ) : (
        <LogWindow />
      )}

      {/* WARN confirmation dialog — rendered on top of everything */}
      {pendingWarn && (
        <ConfirmDialog
          payload={pendingWarn}
          onResolved={() => setPendingWarn(null)}
        />
      )}
    </div>
  );
}
