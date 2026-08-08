import { useEffect, useRef } from "react";
import { useAdbStore } from "../../state/useAdbStore";
import { MAX_TERMINAL_FONT, MIN_TERMINAL_FONT, useUiScaleStore } from "../../state/useUiScaleStore";
import { IconShield } from "../icons";
import { useShellSession } from "./useShellSession";

export function Terminal() {
  const adb = useAdbStore((s) => s.adb);
  const rootAvailable = useAdbStore((s) => s.rootAvailable);
  const { session, sendCtrlC, sendInput, ended, restart } = useShellSession(adb);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalFontSize = useUiScaleStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useUiScaleStore((s) => s.setTerminalFontSize);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !session) return;

    el.appendChild(session.container);
    session.fitAddon.fit();
    session.resize?.(session.term.rows, session.term.cols).catch(() => {});
    session.term.focus();

    const resizeObserver = new ResizeObserver(() => {
      session.fitAddon.fit();
      session.resize?.(session.term.rows, session.term.cols).catch(() => {});
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      // Detach without disposing so the session survives this unmount (e.g. switching tabs).
      if (session.container.parentElement === el) {
        el.removeChild(session.container);
      }
    };
  }, [session]);

  if (!session) {
    return <div className="p-8 text-neutral-500">Starting shell…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      {session.degraded && (
        <div className="border-b border-amber-900 bg-amber-950/50 px-4 py-1.5 text-xs text-amber-300">
          Degraded mode: no PTY resize or Ctrl+C signal on this device — only basic command
          output.
        </div>
      )}
      {ended && (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/60 px-4 py-1.5 text-xs text-neutral-400">
          <span>Shell session ended.</span>
          <button
            type="button"
            onClick={restart}
            className="rounded border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-emerald-300 hover:bg-emerald-900/40"
          >
            New Session
          </button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-b border-neutral-800 px-3 py-1.5">
        <div className="mr-auto flex items-center gap-1 text-xs text-neutral-400">
          <button
            type="button"
            onClick={() => setTerminalFontSize(terminalFontSize - 1)}
            disabled={terminalFontSize <= MIN_TERMINAL_FONT}
            title="Decrease terminal font size"
            aria-label="Decrease terminal font size"
            className="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            A−
          </button>
          <span className="w-8 text-center">{terminalFontSize}px</span>
          <button
            type="button"
            onClick={() => setTerminalFontSize(terminalFontSize + 1)}
            disabled={terminalFontSize >= MAX_TERMINAL_FONT}
            title="Increase terminal font size"
            aria-label="Increase terminal font size"
            className="rounded border border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            A+
          </button>
        </div>
        {rootAvailable && (
          <button
            type="button"
            disabled={ended}
            onClick={() => sendInput("su\n")}
            title="Send `su` to drop into a root shell"
            className="flex items-center gap-1 rounded border border-emerald-800 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-950 disabled:opacity-40"
          >
            <IconShield className="h-3 w-3" />
            su
          </button>
        )}
        <button
          type="button"
          disabled={ended}
          onClick={sendCtrlC}
          className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
        >
          Ctrl+C
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 bg-black p-2" />
    </div>
  );
}
