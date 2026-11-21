import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { short } from "../lib/chain";

type Toast = { id: number; kind: "ok" | "error"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function Address({ value, name }: { value: string; name?: string }) {
  return (
    <span className="address" title={value}>
      {name ? <strong>{name}</strong> : null}
      <code>{short(value)}</code>
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-row">
      <span className="spinner" aria-hidden />
      <span className="muted">{label}…</span>
    </div>
  );
}

export const formatDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export const formatDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function daysLeft(expiry: number) {
  const d = Math.ceil((expiry * 1000 - Date.now()) / 86400000);
  return d <= 0 ? "expired" : d === 1 ? "1 day left" : `${d} days left`;
}

/** Run an async action with busy state and toast feedback. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>, success?: string) => {
      setBusy(label);
      try {
        await fn();
        if (success) toast("ok", success);
        return true;
      } catch (err) {
        const { errorMessage } = await import("../lib/chain");
        toast("error", errorMessage(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
