import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  variant: "default" | "error" | "success";
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, variant?: Toast["variant"]) => void;
  dismiss: (id: string) => void;
}

let _seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, variant = "default") => {
    const id = String(++_seq);
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      4500
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Imperative helpers usable outside React components.
export const toast = {
  show: (message: string) => useToastStore.getState().show(message),
  error: (message: string) => useToastStore.getState().show(message, "error"),
  success: (message: string) => useToastStore.getState().show(message, "success"),
};
