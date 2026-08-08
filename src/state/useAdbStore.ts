import { create } from "zustand";
import type { Adb } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import { connectToDevice, getKnownDevices, requestDevice } from "../lib/adb/connection";
import { classifyAdbError, type ClassifiedAdbError } from "../lib/adb/errors";
import { checkRootAccess } from "../lib/adb/rootAccess";
import type { ConnectionState } from "../lib/adb/types";
import { disposeScreenMirror } from "../components/screen/useScreenMirror";
import { useFileBrowserStore } from "./useFileBrowserStore";
import { useAppsStore } from "./useAppsStore";

// A brief cable wiggle, a phone momentarily re-enumerating its USB interface after a screen-lock,
// or a USB hub hiccup all look identical to the browser: an abrupt disconnect. Retrying quietly a
// few times before giving up and dumping the user back to the Connect screen means those
// momentary blips don't interrupt a session at all.
const RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1500;

// A fresh device session starts the Files tab at a known-good default rather than continuing to
// show wherever a *previous* device session happened to leave off.
function resetFileBrowserState(): void {
  const store = useFileBrowserStore.getState();
  store.setCurrentPath("/sdcard");
  store.setViewMode("list");
  store.setRootMode(false);
  store.setRunAsPackage(null);
}

// Same reasoning — a new physical device shouldn't inherit a stale package list or scan cache
// from whatever was previously connected. Switching tabs on the *same* session never calls this.
function resetAppsState(): void {
  useAppsStore.getState().reset();
}

// Dynamically imported (not a static import) so this always-loaded store doesn't drag xterm.js
// (a transitive dependency of useShellSession.ts) into the initial bundle — it's only needed if
// the Shell tab was actually opened, in which case it's already loaded and this resolves instantly.
function disposeShellSession(): void {
  void import("../components/shell/useShellSession").then((m) => m.disposeShellSession());
}

export type ActiveView = "connect" | "shell" | "files" | "screen" | "apps";

interface AdbStoreState {
  adb: Adb | null;
  device: AdbDaemonWebUsbDevice | null;
  connectionState: ConnectionState;
  error: ClassifiedAdbError | null;
  activeView: ActiveView;
  /** `null` = not checked yet (or not connected); checked once, right after connecting. */
  rootAvailable: boolean | null;
  connect: () => Promise<void>;
  connectToKnownDevice: (device: AdbDaemonWebUsbDevice) => Promise<void>;
  /** Tears down the dead session and kicks off a quiet reconnect loop — shared by the primary
   * `adb.disconnected` path and `useUsbConnectionWatcher`'s browser-level backstop, so an
   * unexpected drop gets identical cleanup regardless of which one notices it first. */
  beginReconnect: (device: AdbDaemonWebUsbDevice) => void;
  /** Connects with no visible "connecting…"/error UI, retrying quietly — used to ride out a
   * momentary drop of a device the user was already using, not for a first-time connection. */
  autoConnectSilently: (device: AdbDaemonWebUsbDevice) => Promise<void>;
  /** Best-effort resume-on-load: if exactly one previously-authorized device is already attached,
   * connects to it without requiring the picker again. Ambiguous (0 or 2+ devices) cases are left
   * for the user to pick from the "Previously used devices" list instead. */
  autoConnectOnLoad: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
  setActiveView: (view: ActiveView) => void;
}

export const useAdbStore = create<AdbStoreState>()((set, get) => {
  // Shared by every successful-connection path (manual, known-device, and silent-retry) so the
  // "now what" wiring — resetting other tabs' state, checking root, watching for the *next*
  // disconnect — can't drift between them.
  function attachSession(adb: Adb, device: AdbDaemonWebUsbDevice): void {
    set({
      adb,
      device,
      connectionState: "connected",
      error: null,
      activeView: get().activeView === "connect" ? "shell" : get().activeView,
    });
    resetFileBrowserState();
    resetAppsState();
    // Non-blocking: don't hold up the "connected" state on this, and a device that prompts
    // for interactive Magisk approval shouldn't stall the rest of the UI while waiting.
    void checkRootAccess(adb).then((available) => {
      if (get().adb === adb) set({ rootAvailable: available });
    });
    // `disconnected` resolves on a graceful close but *rejects* on an abrupt one
    // (e.g. the cable being unplugged), so both branches must run the same cleanup.
    const handleDisconnect = () => {
      // Ignore if a newer connection has since replaced this one, or if this was actually a
      // user-initiated disconnect() — that path already nulled `adb` synchronously before
      // `close()`'s promise could resolve and reach here.
      if (get().adb !== adb) return;
      get().beginReconnect(device);
    };
    adb.disconnected.then(handleDisconnect, handleDisconnect);
  }

  return {
    adb: null,
    device: null,
    connectionState: "idle",
    error: null,
    activeView: "connect",
    rootAvailable: null,

    connect: async () => {
      set({ connectionState: "requesting", error: null });
      try {
        const device = await requestDevice();
        if (!device) {
          set({ connectionState: "idle" });
          return;
        }
        await get().connectToKnownDevice(device);
      } catch (err) {
        set({ connectionState: "error", error: classifyAdbError(err) });
      }
    },

    connectToKnownDevice: async (device) => {
      set({ connectionState: "authenticating", device, error: null });
      try {
        const adb = await connectToDevice(device);
        attachSession(adb, device);
      } catch (err) {
        set({ connectionState: "error", error: classifyAdbError(err), device: null });
      }
    },

    beginReconnect: (device) => {
      disposeShellSession();
      disposeScreenMirror();
      set({ adb: null, connectionState: "reconnecting", rootAvailable: null });
      void get().autoConnectSilently(device);
    },

    autoConnectSilently: async (device) => {
      for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
        // Bail if something else already changed the picture while we were waiting — a manual
        // connect/disconnect, or a newer retry loop (shouldn't happen, but be defensive).
        if (get().connectionState !== "reconnecting") return;
        try {
          const adb = await connectToDevice(device);
          attachSession(adb, device);
          return;
        } catch {
          // Device likely still not back yet — stay quiet and try again rather than flashing an
          // error banner on every blip; only the final exhausted attempt gives up visibly.
        }
      }
      if (get().connectionState === "reconnecting") {
        set({ connectionState: "disconnected", device: null, activeView: "connect" });
      }
    },

    autoConnectOnLoad: async () => {
      if (get().connectionState !== "idle") return;
      const known = await getKnownDevices();
      if (known.length === 1 && get().connectionState === "idle") {
        await get().connectToKnownDevice(known[0]);
      }
    },

    disconnect: () => {
      const { adb } = get();
      disposeShellSession();
      disposeScreenMirror();
      adb?.close().catch(() => {
        // Already broken/closed (e.g. device was unplugged) — nothing to do.
      });
      set({
        adb: null,
        device: null,
        connectionState: "idle",
        activeView: "connect",
        rootAvailable: null,
      });
    },

    clearError: () => set({ error: null }),
    setActiveView: (view) => set({ activeView: view }),
  };
});
