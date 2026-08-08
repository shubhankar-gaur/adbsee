import { useAdbStore, type ActiveView } from "../../state/useAdbStore";

const TABS: { id: ActiveView; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "shell", label: "Shell" },
  { id: "files", label: "Files" },
  { id: "screen", label: "Screen" },
  { id: "apps", label: "Apps" },
];

export function NavTabs() {
  const activeView = useAdbStore((s) => s.activeView);
  const setActiveView = useAdbStore((s) => s.setActiveView);
  const connected = useAdbStore((s) => s.connectionState === "connected");

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-neutral-800 px-4">
      {TABS.map((tab) => {
        const disabled = tab.id !== "connect" && !connected;
        const active = tab.id === activeView;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => setActiveView(tab.id)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-emerald-400 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            } ${disabled ? "cursor-not-allowed opacity-40 hover:text-neutral-400" : ""}`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
