import { create } from "zustand";

export type TransferDirection = "upload" | "download";
export type TransferStatus = "active" | "done" | "error";

export interface Transfer {
  id: string;
  name: string;
  direction: TransferDirection;
  bytesDone: number;
  bytesTotal: number;
  status: TransferStatus;
  error?: string;
}

interface TransferState {
  transfers: Transfer[];
  start: (id: string, name: string, direction: TransferDirection, bytesTotal: number) => void;
  progress: (id: string, bytesDone: number) => void;
  finish: (id: string) => void;
  fail: (id: string, error: string) => void;
  dismiss: (id: string) => void;
}

/** Global so a big transfer stays visible regardless of which tab triggered it or is currently
 * active — mirrors the same "lives outside any one view" reasoning as the screen/dock stores. */
export const useTransferStore = create<TransferState>()((set) => ({
  transfers: [],
  start: (id, name, direction, bytesTotal) =>
    set((s) => ({
      transfers: [...s.transfers, { id, name, direction, bytesDone: 0, bytesTotal, status: "active" }],
    })),
  progress: (id, bytesDone) =>
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, bytesDone } : t)),
    })),
  finish: (id) =>
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, status: "done", bytesDone: t.bytesTotal } : t,
      ),
    })),
  fail: (id, error) =>
    set((s) => ({
      transfers: s.transfers.map((t) => (t.id === id ? { ...t, status: "error", error } : t)),
    })),
  dismiss: (id) => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
}));
