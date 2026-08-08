import { create } from "zustand";

const DEFAULT_WIDTH = 420;

interface DockState {
  open: boolean;
  width: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setWidth: (width: number) => void;
}

/** Whether the cross-tab screen dock panel is open — independent of which tab is active. */
export const useDockStore = create<DockState>()((set) => ({
  open: false,
  width: DEFAULT_WIDTH,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setWidth: (width) => set({ width }),
}));
