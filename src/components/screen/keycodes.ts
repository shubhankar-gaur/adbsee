/**
 * Maps a browser `KeyboardEvent.key` for non-printable keys to an Android keycode
 * (see `android.view.KeyEvent`). Printable keys (`key.length === 1`) go through
 * `input text` instead — see `useDeviceInput.ts`.
 */
export const SPECIAL_KEY_CODES: Record<string, number> = {
  Backspace: 67, // KEYCODE_DEL
  Delete: 112, // KEYCODE_FORWARD_DEL
  Enter: 66, // KEYCODE_ENTER
  Tab: 61, // KEYCODE_TAB
  Escape: 4, // KEYCODE_BACK
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 3, // KEYCODE_HOME
  PageUp: 92,
  PageDown: 93,
};

/**
 * Dedicated system-navigation keycodes for toolbar buttons — distinct from `SPECIAL_KEY_CODES`
 * above, which maps *browser* key names for the keyboard-passthrough path. `recents` in
 * particular has no browser key to map from at all: the real gesture (swipe up from the bottom
 * edge, pause partway through, then release) needs a hold mid-motion that a single linear `input
 * swipe` command can't reproduce, and devices on 2/3-button navigation don't have a swipe for it
 * in the first place. The keycode works the same way regardless of which navigation mode is
 * active, so it's the reliable option rather than trying to simulate the gesture.
 */
export const NAV_KEYCODES = {
  back: 4, // KEYCODE_BACK
  home: 3, // KEYCODE_HOME
  recents: 187, // KEYCODE_APP_SWITCH
} as const;
