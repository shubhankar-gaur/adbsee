import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "adbsee-theme";

// Every component's existing className strings (bg-neutral-900, text-emerald-300, etc.) already
// respond to this — see the `[data-theme="light"]` CSS variable overrides in
// `src/styles/index.css`. This attribute is the only thing that actually switches the theme;
// nothing else needs touching per-component.
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function getInitialTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// Applied at module load — before the first render — so a saved "dark" preference doesn't
// flash light for a frame on reload.
const initialTheme = getInitialTheme();
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
