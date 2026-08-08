import { useEffect, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Adb, AdbNoneProtocolPtyProcess, AdbShellProtocolPtyProcess } from "@yume-chan/adb";
import type { ReadableStream } from "@yume-chan/stream-extra";
import { useUiScaleStore } from "../../state/useUiScaleStore";

export interface ShellSession {
  adb: Adb;
  term: XTerm;
  fitAddon: FitAddon;
  pty: AdbShellProtocolPtyProcess | AdbNoneProtocolPtyProcess;
  /** Only available when the device supports the shell protocol. */
  resize: ((rows: number, cols: number) => Promise<void>) | undefined;
  degraded: boolean;
  /** Detached DOM node holding the xterm canvas; reparented by Terminal.tsx. */
  container: HTMLDivElement;
  /** Writes text into the PTY's stdin, exactly as if the user had typed it. */
  sendInput: (text: string) => void;
  /** Resolves once the underlying shell process has ended for any reason — typing `exit`
   * (including exiting a nested `su` shell, on devices where that ends the whole pty rather than
   * returning to the parent shell), a crash, or the device disconnecting. Lets consumers offer a
   * fresh session instead of leaving a dead, unrecoverable terminal on screen. */
  ended: Promise<void>;
}

// Module-level so the running process + xterm scrollback survive Terminal.tsx
// unmounting when the user switches to another tab and back.
let currentSession: ShellSession | null = null;
let pendingCreation: Promise<ShellSession> | null = null;

// Live-updates the *current* terminal instance's font size when the setting changes — xterm
// renders to a canvas, so this can't happen via CSS the way the rest of the app's text does; it
// needs the actual live `term`/`fitAddon` instances, which only this module has access to.
useUiScaleStore.subscribe((state, prev) => {
  if (state.terminalFontSize !== prev.terminalFontSize && currentSession) {
    currentSession.term.options.fontSize = state.terminalFontSize;
    currentSession.fitAddon.fit();
  }
});

async function createSession(adb: Adb): Promise<ShellSession> {
  const term = new XTerm({
    convertEol: true,
    fontSize: useUiScaleStore.getState().terminalFontSize,
    fontFamily: "Menlo, Consolas, monospace",
    theme: { background: "#000000" },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const container = document.createElement("div");
  container.style.height = "100%";
  container.style.width = "100%";
  term.open(container);

  const shellProtocol = adb.subprocess.shellProtocol;
  const degraded = !shellProtocol;
  let pty: AdbShellProtocolPtyProcess | AdbNoneProtocolPtyProcess;
  let resize: ((rows: number, cols: number) => Promise<void>) | undefined;
  if (shellProtocol) {
    pty = await shellProtocol.pty({ terminalType: "xterm-256color" });
    resize = pty.resize.bind(pty);
  } else {
    pty = await adb.subprocess.noneProtocol.pty();
    resize = undefined;
  }

  if (degraded) {
    term.writeln(
      "\x1b[33mThis device's ADB doesn't support the shell protocol: no resize, no Ctrl+C signal, stdout/stderr are merged.\x1b[0m\r\n",
    );
  }

  // The socket closing (e.g. on disconnect) rejects `exited`; nothing here awaits it directly,
  // so without this it would surface as an unhandled promise rejection.
  pty.exited.catch(() => {});
  let resolveEnded: (() => void) | undefined;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  void pipePtyOutputToTerminal(pty, term).finally(() => resolveEnded?.());

  const writer = pty.input.getWriter();
  const encoder = new TextEncoder();
  const sendInput = (text: string) => {
    writer.write(encoder.encode(text)).catch(() => {});
  };
  term.onData(sendInput);

  return { adb, term, fitAddon, pty, resize, degraded, container, sendInput, ended };
}

async function pipePtyOutputToTerminal(
  pty: { output: ReadableStream<Uint8Array> },
  term: XTerm,
): Promise<void> {
  const reader = pty.output.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      term.write(value);
    }
  } catch {
    // Stream errored, most likely the device disconnected; fall through to the banner below.
  }
  term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
}

function disposeSession(session: ShellSession): void {
  session.term.dispose();
  Promise.resolve(session.pty.kill()).catch(() => {});
}

function getOrCreateSession(adb: Adb): Promise<ShellSession> {
  if (currentSession?.adb === adb) {
    return Promise.resolve(currentSession);
  }
  if (pendingCreation) {
    return pendingCreation;
  }
  if (currentSession) {
    disposeSession(currentSession);
    currentSession = null;
  }
  pendingCreation = createSession(adb).then((session) => {
    currentSession = session;
    pendingCreation = null;
    return session;
  });
  return pendingCreation;
}

/** Call when the ADB connection is torn down entirely, to release the PTY and xterm instance. */
export function disposeShellSession(): void {
  if (currentSession) {
    disposeSession(currentSession);
    currentSession = null;
  }
  pendingCreation = null;
}

/** Tears down the current (dead or otherwise) session and starts a fresh one — used to recover
 * from a shell that's exited (`exit`, a nested `su` shell ending the whole pty on some devices,
 * a crash) without needing to disconnect and reconnect the device entirely. */
function restartShellSession(adb: Adb): Promise<ShellSession> {
  if (currentSession) {
    disposeSession(currentSession);
    currentSession = null;
  }
  return getOrCreateSession(adb);
}

export function useShellSession(adb: Adb | null) {
  const [session, setSession] = useState<ShellSession | null>(
    adb && currentSession?.adb === adb ? currentSession : null,
  );
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!adb) return;
    let cancelled = false;
    void getOrCreateSession(adb).then((s) => {
      if (!cancelled) setSession(s);
    });
    return () => {
      cancelled = true;
    };
  }, [adb]);

  // Re-subscribes whenever `session` changes to a new instance (a fresh session's `ended`
  // hasn't resolved yet) — also correctly picks up a session that had *already* ended before
  // this component subscribed (e.g. switching tabs away and back), since a resolved promise's
  // `.then()` still fires.
  useEffect(() => {
    if (!session) return;
    setEnded(false);
    let cancelled = false;
    void session.ended.then(() => {
      if (!cancelled) setEnded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const restart = () => {
    if (!adb) return;
    void restartShellSession(adb).then(setSession);
  };

  const sendCtrlC = () => {
    session?.pty.sigint().catch(() => {});
  };

  const sendInput = (text: string) => {
    session?.sendInput(text);
  };

  return { session: adb ? session : null, sendCtrlC, sendInput, ended, restart };
}
