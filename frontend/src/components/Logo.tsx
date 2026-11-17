import { cn } from '../utils/format';

/** Mark: a painted "L" stall marking beside a parked car outline; wordmark in expanded Archivo. */
export function Logo({ compact, dark = true }: { compact?: boolean; dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#161B21" />
        <path d="M14 46V18h6v22h12v6z" fill="#F2C230" />
        <rect x="36" y="18" width="14" height="28" rx="5" fill="none" stroke="#F7F8F6" strokeWidth="4" />
        <path d="M39 24h8" stroke="#F7F8F6" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className={cn('leading-none', dark ? 'text-white' : 'text-ink')}>
          <span className="block text-[17px] font-bold tracking-tight" style={{ fontStretch: '118%' }}>
            LotFlow AI
          </span>
          <span className={cn('mt-1 block text-[11px]', dark ? 'text-[#8b95a3]' : 'text-muted')}>Dealership operations intelligence</span>
        </span>
      )}
      {compact && (
        <span className={cn('text-[16px] font-bold tracking-tight', dark ? 'text-white' : 'text-ink')} style={{ fontStretch: '118%' }}>
          LotFlow AI
        </span>
      )}
    </span>
  );
}
