import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useAdbStore } from "../../state/useAdbStore";
import { downloadBlob } from "../../lib/downloadBlob";
import { IconNavBack, IconNavHome, IconNavRecents } from "../icons";
import { NAV_KEYCODES, SPECIAL_KEY_CODES } from "./keycodes";
import { takeScreenshot } from "./useScreenshot";
import { useScreenMirror } from "./useScreenMirror";
import { useDeviceInput } from "./useDeviceInput";

const POLL_FALLBACK_INTERVAL_MS = 1500;

export interface ScreenViewProps {
  /** When provided, renders a "Screen" label + close button inline in the toolbar (dock usage). */
  onClose?: () => void;
}

export function ScreenView({ onClose }: ScreenViewProps = {}) {
  const adb = useAdbStore((s) => s.adb);
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mirror = useScreenMirror(adb);
  const { tap, swipe, keyEvent, typeText, pasteText } = useDeviceInput(adb);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!screenshotBlob) return;
    const url = URL.createObjectURL(screenshotBlob);
    setScreenshotUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshotBlob]);

  const handleScreenshot = async () => {
    if (!adb) return;
    setBusy(true);
    setError(null);
    try {
      setScreenshotBlob(await takeScreenshot(adb));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (screenshotBlob) downloadBlob(screenshotBlob, `screenshot-${Date.now()}.png`);
  };

  // WebCodecs live decode when available; otherwise fall back to polling screenshots into
  // the same canvas — degraded (no real-time feel), but still a usable device view.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mirror.running || mirror.unsupported) return;

    const ctx = canvas.getContext("2d");
    mirror.setOnFrame((frame) => {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    });

    return () => mirror.setOnFrame(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror.running, mirror.unsupported]);

  useEffect(() => {
    if (!adb || !mirror.unsupported || !mirror.running) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    let cancelled = false;

    const poll = async () => {
      try {
        const blob = await takeScreenshot(adb);
        if (cancelled || !canvas || !ctx) return;
        const bitmap = await createImageBitmap(blob);
        if (cancelled) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      } catch {
        // A single missed poll isn't worth surfacing as an error.
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_FALLBACK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [adb, mirror.unsupported, mirror.running]);

  // `input tap`/`input swipe` always take coordinates in the device's real display resolution —
  // completely unrelated to whatever resolution the mirror is actually capturing/decoding at
  // (screen mirroring can capture at a downscaled size for speed; see `useScreenMirror.ts`'s
  // `maxSize` option). So this maps in two steps: CSS pixels → canvas-internal pixels (the video's
  // own resolution), then canvas-internal pixels → real device pixels via `mirror.nativeSize`.
  // When `nativeSize` isn't known (not yet queried, or the screenshot-polling fallback, which
  // already renders at native resolution) the second step is a no-op 1:1 mapping.
  const toDeviceCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (clientY - rect.top) * (canvas.height / rect.height);
    const native = mirror.nativeSize;
    if (!native) return { x: canvasX, y: canvasY };
    return {
      x: canvasX * (native.width / canvas.width),
      y: canvasY * (native.height / canvas.height),
    };
  };

  const handlePointerDown = (e: MouseEvent<HTMLCanvasElement>) => {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: MouseEvent<HTMLCanvasElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const from = toDeviceCoords(start.x, start.y);
    const to = toDeviceCoords(e.clientX, e.clientY);
    if (!from || !to) return;
    const dragDistance = Math.hypot(to.x - from.x, to.y - from.y);
    if (dragDistance < 10) {
      void tap(to.x, to.y);
    } else {
      void swipe(from.x, from.y, to.x, to.y);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    // Don't hijack OS/browser shortcuts (Ctrl+C, Cmd+Tab, etc.) — only plain keys go to the device.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const specialCode = SPECIAL_KEY_CODES[e.key];
    if (specialCode !== undefined) {
      e.preventDefault();
      void keyEvent(specialCode);
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      void typeText(e.key);
    }
  };

  // Fires on a real Ctrl+V/Cmd+V (or right-click paste) while the canvas is focused — reading
  // `clipboardData` directly here needs no permission prompt, unlike the Async Clipboard API,
  // since it's a direct response to the browser's own paste action rather than an on-demand read.
  const handlePaste = (e: ClipboardEvent<HTMLCanvasElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    void pasteText(text);
  };

  // A toolbar fallback for triggering the same thing without a focused-canvas keyboard shortcut
  // — this path does need the Async Clipboard API (and its permission prompt), unlike onPaste.
  const handlePasteButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) await pasteText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => void handleScreenshot()}
          disabled={busy}
          className="rounded bg-emerald-500 px-3 py-1 font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? "Capturing…" : "Screenshot"}
        </button>
        {screenshotBlob && (
          <button
            type="button"
            onClick={handleDownload}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Download
          </button>
        )}
        <span className="mx-2 h-4 w-px bg-neutral-800" />
        {mirror.running ? (
          <button
            type="button"
            onClick={mirror.stop}
            className="rounded border border-red-900 px-2 py-1 text-red-300 hover:bg-red-950"
          >
            Stop Mirror
          </button>
        ) : (
          <button
            type="button"
            onClick={() => mirror.start()}
            className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Start Mirror
          </button>
        )}
        {mirror.running && (
          <>
            {/* The dock is a small side panel meant to stay out of the way while you work in
             another tab — Paste stays a toolbar button only in the full Screen tab, where there's
             room for it; Ctrl+V still works in the dock via the canvas's own paste handler. */}
            {!onClose && (
              <button
                type="button"
                onClick={() => void handlePasteButton()}
                title="Paste clipboard text into the focused field on the device"
                className="rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
              >
                Paste
              </button>
            )}
            <span className="mx-1 h-4 w-px bg-neutral-800" />
            <button
              type="button"
              onClick={() => void keyEvent(NAV_KEYCODES.back)}
              title="Back"
              aria-label="Back"
              className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <IconNavBack />
            </button>
            <button
              type="button"
              onClick={() => void keyEvent(NAV_KEYCODES.home)}
              title="Home"
              aria-label="Home"
              className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <IconNavHome />
            </button>
            <button
              type="button"
              onClick={() => void keyEvent(NAV_KEYCODES.recents)}
              title="Recent apps — sent via KEYCODE_APP_SWITCH rather than simulating the hold-and-swipe gesture, which a linear input-swipe command can't reproduce reliably"
              aria-label="Recent apps"
              className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <IconNavRecents />
            </button>
          </>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-neutral-500 hover:text-neutral-200"
            aria-label="Close screen dock"
          >
            ✕
          </button>
        )}
      </div>

      {mirror.unsupported && mirror.running && (
        <div className="border-b border-amber-900 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-300">
          This browser doesn't support WebCodecs — showing periodic screenshots instead of a live
          feed. Try Chrome or Edge for real-time mirroring.
        </div>
      )}

      {(error ?? mirror.error) && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error ?? mirror.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black p-4">
        {mirror.running ? (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseDown={handlePointerDown}
            onMouseUp={handlePointerUp}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="max-h-full max-w-full cursor-pointer object-contain outline-none focus:ring-2 focus:ring-emerald-500"
          />
        ) : screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt="Device screenshot"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="text-neutral-600">Click Screenshot to capture, or Start Mirror to view live.</p>
        )}
      </div>
    </div>
  );
}
