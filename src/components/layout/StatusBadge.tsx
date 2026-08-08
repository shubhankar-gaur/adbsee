import { useAdbStore } from "../../state/useAdbStore";
import { IconShield } from "../icons";

const LABELS: Record<string, string> = {
  idle: "Not connected",
  requesting: "Selecting device…",
  authenticating: "Authenticating…",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
};

const DOT_CLASSES: Record<string, string> = {
  idle: "bg-neutral-500",
  requesting: "bg-amber-400 animate-pulse",
  authenticating: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  disconnected: "bg-neutral-500",
  error: "bg-red-500",
};

export function StatusBadge() {
  const connectionState = useAdbStore((s) => s.connectionState);
  const adb = useAdbStore((s) => s.adb);
  const rootAvailable = useAdbStore((s) => s.rootAvailable);
  const disconnect = useAdbStore((s) => s.disconnect);

  const model = adb?.banner.model ?? adb?.banner.product;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${DOT_CLASSES[connectionState]}`} />
        <span className="text-neutral-300">{LABELS[connectionState]}</span>
      </span>
      {adb && (
        <>
          <span className="text-neutral-500">
            {model ?? "unknown device"} · {adb.serial}
          </span>
          {rootAvailable && (
            <span
              className="flex items-center gap-1 rounded border border-emerald-800 px-1.5 py-0.5 text-xs text-emerald-300"
              title="Root access available on this device"
            >
              <IconShield className="h-3 w-3" />
              Root
            </span>
          )}
          <button
            type="button"
            onClick={disconnect}
            className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}
