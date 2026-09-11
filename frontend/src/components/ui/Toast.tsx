import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
}
interface ToastItem extends ToastInput {
  id: number;
}
interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback(
    (id: number) => setItems((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const toast = useCallback(
    (input: ToastInput) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-2), { ...input, id }]);
      window.setTimeout(() => dismiss(id), 4_500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
        aria-live="polite"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ToastCard = ({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) => {
  const dot =
    item.tone === 'error'
      ? 'bg-red-500'
      : item.tone === 'success'
        ? 'bg-emerald-500'
        : 'bg-neutral-500';
  return (
    <div className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl shadow-neutral-950/10">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-neutral-950">{item.title}</p>
        {item.description && (
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="text-neutral-400 hover:text-neutral-950"
      >
        ×
      </button>
    </div>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
};
