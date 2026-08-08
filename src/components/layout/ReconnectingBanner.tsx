import { useAdbStore } from "../../state/useAdbStore";

/** Shown app-wide (not just on the Connect tab) because the user stays on whatever tab they were
 * using when the device dropped — `useAdbStore`'s reconnect logic deliberately doesn't kick them
 * back to Connect for what's usually a momentary cable/USB hiccup, so this is the only feedback
 * they'd otherwise get that something's happening. */
export function ReconnectingBanner() {
  const connectionState = useAdbStore((s) => s.connectionState);
  const device = useAdbStore((s) => s.device);

  if (connectionState !== "reconnecting") return null;

  return (
    <div className="flex items-center gap-2 border-b border-amber-900 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
      <span>
        Connection dropped — reconnecting to {device?.name || device?.serial || "the device"}…
      </span>
    </div>
  );
}
