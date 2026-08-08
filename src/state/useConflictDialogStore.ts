import { create } from "zustand";

export type ConflictResolution =
  | { action: "skip" }
  | { action: "rename"; name: string }
  | { action: "replace" };

interface PendingConflict {
  fileName: string;
  suggestedName: string;
  resolve: (choice: ConflictResolution) => void;
}

interface ConflictDialogState {
  pending: PendingConflict | null;
  /** Resolves once the user (via `<ConflictDialog>`) picks skip/rename/replace. */
  request: (fileName: string, suggestedName: string) => Promise<ConflictResolution>;
  resolve: (choice: ConflictResolution) => void;
}

export const useConflictDialogStore = create<ConflictDialogState>()((set, get) => ({
  pending: null,
  request: (fileName, suggestedName) =>
    new Promise<ConflictResolution>((resolve) => {
      set({ pending: { fileName, suggestedName, resolve } });
    }),
  resolve: (choice) => {
    get().pending?.resolve(choice);
    set({ pending: null });
  },
}));
