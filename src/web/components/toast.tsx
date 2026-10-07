// Success toasts (docs/ui.md 7): bottom of the screen, 3 seconds, read by
// screen readers through a polite live region that is always mounted.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const TOAST_MS = 3000;

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);

/** No-op outside the provider (e.g. pages rendered alone in tests). */
export function useToast(): ShowToast {
  return useContext(ToastContext) ?? noop;
}
const noop: ShowToast = () => undefined;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const seq = useRef(0);
  const show = useCallback<ShowToast>((message) => setToast({ id: ++seq.current, message }), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-8"
      >
        {toast && (
          <p
            key={toast.id}
            className="anim-toast rounded-lg border border-border bg-text px-4 py-2.5 text-sm font-medium text-bg"
          >
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
