import { useAdbStore } from "../../state/useAdbStore";

export function ErrorBanner() {
  const error = useAdbStore((s) => s.error);
  const clearError = useAdbStore((s) => s.clearError);

  if (!error) return null;

  return (
    <div className="flex items-start justify-between gap-4 border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-300">
      <span>{error.message}</span>
      <button
        type="button"
        onClick={clearError}
        className="shrink-0 text-red-300 hover:opacity-70"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
