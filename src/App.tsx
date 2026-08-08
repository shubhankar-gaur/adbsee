import { lazy, Suspense } from "react";
import { BrowserSupportGate } from "./components/layout/BrowserSupportGate";
import { StatusBadge } from "./components/layout/StatusBadge";
import { ErrorBanner } from "./components/layout/ErrorBanner";
import { ReconnectingBanner } from "./components/layout/ReconnectingBanner";
import { NavTabs } from "./components/layout/NavTabs";
import { ConnectView } from "./components/connect/ConnectView";
import { IconDock, IconMoon, IconSun } from "./components/icons";
import { Logo } from "./components/Logo";
import { ConflictDialog } from "./components/files/ConflictDialog";
import { TransferToastStack } from "./components/transfers/TransferToastStack";
import { useUsbConnectionWatcher } from "./hooks/useUsbConnectionWatcher";
import { useAdbStore } from "./state/useAdbStore";
import { useDockStore } from "./state/useDockStore";
import { useThemeStore } from "./state/useThemeStore";
import { UI_SCALE_STEPS, useUiScaleStore } from "./state/useUiScaleStore";

// Connect is needed on first paint; every other tab (and its dependencies — xterm, WebCodecs
// plumbing, etc.) only loads once the user actually opens it.
const Terminal = lazy(() => import("./components/shell/Terminal").then((m) => ({ default: m.Terminal })));
const FileBrowserView = lazy(() =>
  import("./components/files/FileBrowserView").then((m) => ({ default: m.FileBrowserView })),
);
const ScreenView = lazy(() => import("./components/screen/ScreenView").then((m) => ({ default: m.ScreenView })));
const AppsView = lazy(() => import("./components/apps/AppsView").then((m) => ({ default: m.AppsView })));
const ScreenDockPanel = lazy(() =>
  import("./components/screen/ScreenDockPanel").then((m) => ({ default: m.ScreenDockPanel })),
);

function ActiveViewPanel() {
  const activeView = useAdbStore((s) => s.activeView);

  switch (activeView) {
    case "connect":
      return <ConnectView />;
    case "shell":
      return <Terminal />;
    case "files":
      return <FileBrowserView />;
    case "screen":
      return <ScreenView />;
    case "apps":
      return <AppsView />;
  }
}

function App() {
  useUsbConnectionWatcher();
  const connected = useAdbStore((s) => s.connectionState === "connected");
  const activeView = useAdbStore((s) => s.activeView);
  const dockOpen = useDockStore((s) => s.open);
  const toggleDock = useDockStore((s) => s.toggle);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const uiScale = useUiScaleStore((s) => s.uiScale);
  const setUiScale = useUiScaleStore((s) => s.setUiScale);

  // No point showing the mini dock when the full Screen tab is already the main view.
  const showDock = dockOpen && connected && activeView !== "screen";

  const scaleIndex = UI_SCALE_STEPS.indexOf(uiScale as (typeof UI_SCALE_STEPS)[number]);
  const zoomOut = () => {
    const idx = scaleIndex === -1 ? UI_SCALE_STEPS.indexOf(100) : scaleIndex;
    if (idx > 0) setUiScale(UI_SCALE_STEPS[idx - 1]);
  };
  const zoomIn = () => {
    const idx = scaleIndex === -1 ? UI_SCALE_STEPS.indexOf(100) : scaleIndex;
    if (idx < UI_SCALE_STEPS.length - 1) setUiScale(UI_SCALE_STEPS[idx + 1]);
  };

  return (
    <BrowserSupportGate>
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <h1 className="text-sm font-semibold tracking-wide text-neutral-200">ADBSee</h1>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge />
            <div className="flex items-center gap-1 text-xs text-neutral-400">
              <button
                type="button"
                onClick={zoomOut}
                disabled={scaleIndex === 0}
                title="Zoom out (scales the whole app, not just text)"
                aria-label="Zoom out"
                className="rounded border border-neutral-700 px-1.5 py-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="w-9 text-center">{uiScale}%</span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={scaleIndex === UI_SCALE_STEPS.length - 1}
                title="Zoom in (scales the whole app, not just text)"
                aria-label="Zoom in"
                className="rounded border border-neutral-700 px-1.5 py-1 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label="Toggle theme"
              className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <button
              type="button"
              onClick={toggleDock}
              disabled={!connected}
              title={dockOpen ? "Hide screen dock" : "Show screen dock"}
              aria-label="Toggle screen dock"
              className={`rounded border p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                dockOpen
                  ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              <IconDock />
            </button>
          </div>
        </header>
        <ErrorBanner />
        <ReconnectingBanner />
        <NavTabs />
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Suspense fallback={<div className="p-8 text-neutral-600">Loading…</div>}>
              <ActiveViewPanel />
            </Suspense>
          </main>
          {showDock && (
            <Suspense fallback={null}>
              <ScreenDockPanel />
            </Suspense>
          )}
        </div>
      </div>
      <TransferToastStack />
      <ConflictDialog />
    </BrowserSupportGate>
  );
}

export default App;
