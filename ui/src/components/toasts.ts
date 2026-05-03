import { useSyncExternalStore } from "react";

export type ToastKind = "error" | "info" | "success";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  /** Optional longer detail — shown in a collapsible <details> when present. */
  detail?: string;
  actions?: ToastAction[];
  /** ms — null/undefined means sticky (user dismisses). Errors default to sticky. */
  timeoutMs?: number | null;
}

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export const showToast = (input: Omit<Toast, "id">): number => {
  const id = nextId++;
  const toast: Toast = { ...input, id };
  toasts = [...toasts, toast];
  emit();
  const ms = toast.timeoutMs ?? (toast.kind === "error" ? null : 4000);
  if (ms != null) {
    setTimeout(() => dismissToast(id), ms);
  }
  return id;
};

export const dismissToast = (id: number) => {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const getSnapshot = () => toasts;

export const useToasts = (): Toast[] =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
