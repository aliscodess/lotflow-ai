import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { cn, toneClasses, type Tone } from '../utils/format';

/* ---------- Button ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'paint';
type Size = 'sm' | 'md' | 'lg';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#2650d6] shadow-sm shadow-brand/20 disabled:bg-brand/50',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-bad/10 text-bad ring-1 ring-inset ring-bad/30 hover:bg-bad/15',
  paint: 'bg-paint text-asphalt hover:bg-[#ffd14a] font-semibold',
};
const SIZE: Record<Size, string> = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-5 text-[15px] gap-2' };

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60', VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* ---------- Badge ---------- */
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', toneClasses[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------- Panel ---------- */
export function Panel({ title, subtitle, actions, children, className, bodyClassName, id }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn('rounded-2xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="t-title text-[15px]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="t-display text-2xl sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- States ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 px-6 py-10 text-center">
      <CircleAlert className="size-7 text-bad" />
      <p className="max-w-md text-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-5 animate-spin text-muted', className)} />;
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 ring-1 ring-line ring-inset scrollbar-thin', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('t-num rounded px-1 text-[11px]', value === o.value ? 'bg-surface-2' : 'bg-transparent')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Form fields ---------- */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}
const inputBase = 'w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(inputBase, 'h-10', className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(inputBase, 'py-2.5', className)} {...p} />);
Textarea.displayName = 'Textarea';
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, 'h-10 pr-8', className)} {...p}>
      {children}
    </select>
  );
}

/* ---------- Drawer / sheet ---------- */
export function Drawer({ open, onClose, title, children, width = 'max-w-md' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('animate-rise absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:rounded-none sm:rounded-l-2xl', width)}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur">
          <div className="min-w-0 font-semibold">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Meter ---------- */
export function Meter({ value, max = 100, color, className }: { value: number; max?: number; color?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line ring-inset', className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color || 'var(--color-brand)' }} />
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}
