import { create } from "zustand";

/**
 * Two independent "make things bigger" controls, because they work through completely different
 * mechanisms:
 *
 * - `uiScale` scales the *entire* app (Files, Apps, Connect, dialogs, everything) with a single
 *   line — Tailwind v4's utilities are all `rem`-based (`text-xs` is `.75rem`, `p-3` is
 *   `calc(var(--spacing) * 3)` where `--spacing` is itself `.25rem`), and `rem` is relative to the
 *   root `<html>` element's font-size. Changing that one value scales every existing className in
 *   the app proportionally — text *and* spacing together, like a zoom level — with no component
 *   changes needed.
 * - `terminalFontSize` exists separately because xterm.js renders into a `<canvas>`, not styled
 *   DOM text — CSS font-size has no effect on it at all. It needs its own explicit
 *   `term.options.fontSize` set directly (done in `useShellSession.ts`, which owns the live
 *   terminal instance).
 */

const UI_SCALE_KEY = "adbsee-ui-scale";
const TERMINAL_FONT_KEY = "adbsee-terminal-font-size";

export const UI_SCALE_STEPS = [90, 100, 110, 125, 150] as const;
const DEFAULT_UI_SCALE = 100;

export const MIN_TERMINAL_FONT = 10;
export const MAX_TERMINAL_FONT = 24;
const DEFAULT_TERMINAL_FONT = 18;

function applyUiScale(scale: number): void {
  document.documentElement.style.fontSize = `${scale}%`;
}

function readNumber(key: string, fallback: number): number {
  const n = Number(localStorage.getItem(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface UiScaleState {
  uiScale: number;
  terminalFontSize: number;
  setUiScale: (scale: number) => void;
  setTerminalFontSize: (size: number) => void;
}

// Applied at module load — before the first render — so a saved scale doesn't flash at 100%
// for a frame on reload, same reasoning as `useThemeStore.ts`.
const initialUiScale = readNumber(UI_SCALE_KEY, DEFAULT_UI_SCALE);
applyUiScale(initialUiScale);

export const useUiScaleStore = create<UiScaleState>()((set) => ({
  uiScale: initialUiScale,
  terminalFontSize: readNumber(TERMINAL_FONT_KEY, DEFAULT_TERMINAL_FONT),
  setUiScale: (scale) => {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
    applyUiScale(scale);
    set({ uiScale: scale });
  },
  setTerminalFontSize: (size) => {
    const clamped = Math.min(MAX_TERMINAL_FONT, Math.max(MIN_TERMINAL_FONT, size));
    localStorage.setItem(TERMINAL_FONT_KEY, String(clamped));
    set({ terminalFontSize: clamped });
  },
}));
