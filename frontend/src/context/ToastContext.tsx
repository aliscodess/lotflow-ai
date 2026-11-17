import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, Siren, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../utils/format';

type Kind = 'success' | 'error' | 'info' | 'alert';
interface Toast {
  id: number;
  title: string;
  message?: string;
  kind: Kind;
  link?: string;
}

const ToastContext = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => {} });

const ICON = { success: CircleCheck, error: CircleAlert, info: Info, alert: Siren };
const RULE = { success: 'bg-ok', error: 'bg-bad', info: 'bg-brand', alert: 'bg-bad' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'alert' ? 7000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5">
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className="animate-rise pointer-events-auto relative flex w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/20"
            >
              <span className={cn('w-1 shrink-0', RULE[t.kind])} />
              <button
                type="button"
                onClick={() => {
                  if (t.link) navigate(t.link);
                  dismiss(t.id);
                }}
                className="flex flex-1 items-start gap-3 p-3 text-left"
              >
                <Icon className={cn('mt-0.5 size-5 shrink-0', t.kind === 'success' ? 'text-ok' : t.kind === 'info' ? 'text-brand dark:text-brand-2' : 'text-bad')} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t.title}</span>
                  {t.message && <span className="mt-0.5 block text-sm text-muted">{t.message}</span>}
                </span>
              </button>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="p-3 text-faint hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
