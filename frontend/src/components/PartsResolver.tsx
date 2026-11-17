import { useState } from 'react';
import { Check, CircleCheck, Leaf, Package, Truck } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { useToast } from '../context/ToastContext';
import { Button } from './ui';
import { cn, inr } from '../utils/format';
import type { Resolution } from '../types';

/** Parts shortage resolver: store-by-store stock, AI recommendation and one-click resolution. */
export function PartsResolver({ resolution, taskId, onResolved }: { resolution: Resolution; taskId: string; onResolved: (message: string) => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const best = resolution.options.find((o) => o.recommended);
  const alt = resolution.options.find((o) => !o.recommended);
  const transfer = resolution.options.find((o) => o.type === 'TRANSFER');
  const reschedule = resolution.options.find((o) => o.type === 'RESCHEDULE');

  const apply = async (strategy: string) => {
    setBusy(strategy);
    try {
      const r = await api.resolveParts(taskId, resolution.part.partNumber, strategy);
      setDone(r.message);
      push({ title: strategy === 'TRANSFER' ? 'Part transfer requested' : strategy === 'RESCHEDULE' ? 'Job rescheduled' : 'Part ordered', message: r.message, kind: 'success' });
      onResolved(r.message);
    } catch (err) {
      push({ title: 'Could not resolve the shortage', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (done) return <ResolvedNotice message={done} />;

  return (
    <div className="rounded-xl border border-warn/40 bg-warn/[0.04]">
      <div className="flex items-start gap-3 border-b border-warn/25 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warn/15 text-warn">
          <Package className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Parts shortage detected</p>
          <p className="text-sm text-muted">
            {resolution.part.name} <span className="text-faint">({resolution.part.partNumber})</span> × {resolution.qty} · {resolution.part.brand}
          </p>
        </div>
      </div>

      <div className="p-4">
        <p className="text-xs text-faint">Stock across the group</p>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {resolution.stores.map((s) => (
            <li key={s.code} className={cn('flex items-center gap-3 px-3 py-2.5 text-sm', best?.storeName === s.name && 'bg-ok/5')}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.isLocal ? `${s.name} (this store)` : s.name}</span>
                <span className="text-faint">
                  {' '}
                  · {s.label}
                  {!s.isLocal && ` · ${s.distanceKm} km`}
                </span>
              </span>
              <span className={cn('t-num font-semibold', s.available > 0 ? 'text-ok' : 'text-faint')}>{s.available} available</span>
            </li>
          ))}
        </ul>

        {best && (
          <div className="mt-4 rounded-lg bg-surface p-4 ring-1 ring-line ring-inset">
            <p className="text-xs font-medium text-brand dark:text-brand-2">AI recommendation</p>
            <p className="mt-1 font-semibold">Best option: {best.title}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
              {best.distanceKm !== undefined && (
                <div>
                  <dt className="text-xs text-faint">Distance</dt>
                  <dd className="t-num">{best.distanceKm} km</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-faint">Estimated delay</dt>
                <dd>{best.delayLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Part arrives</dt>
                <dd>{best.etaLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Job starts</dt>
                <dd>
                  {best.newStartLabel}
                  {best.bayName ? `, ${best.bayName}` : ''}
                </dd>
              </div>
            </dl>
            {best.via && <p className="mt-2 text-sm text-muted">{best.via}.</p>}
            {alt && (
              <p className="mt-3 border-t border-line pt-3 text-sm">
                <span className="text-faint">Alternative: </span>
                <span className="font-medium">{alt.title}</span>
                {alt.via ? <span className="text-muted">. {alt.via}.</span> : alt.delayLabel ? <span className="text-muted"> (delay {alt.delayLabel}).</span> : null}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-faint">
              {transfer && (
                <span className="inline-flex items-center gap-1">
                  <Truck className="size-3.5" /> Transfer cost {inr(transfer.costINR)}
                </span>
              )}
              {reschedule && (
                <span className="inline-flex items-center gap-1">
                  <Leaf className="size-3.5" /> Parts run adds no extra trip
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {transfer && (
            <Button onClick={() => apply('TRANSFER')} loading={busy === 'TRANSFER'} disabled={busy !== null} icon={<Truck className="size-4" />}>
              Transfer part
            </Button>
          )}
          {reschedule && (
            <Button variant="secondary" onClick={() => apply('RESCHEDULE')} loading={busy === 'RESCHEDULE'} disabled={busy !== null}>
              Reschedule job
            </Button>
          )}
          {!transfer && !reschedule && (
            <Button onClick={() => apply('BACKORDER')} loading={busy === 'BACKORDER'}>
              Order from OEM
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ResolvedNotice({ message }: { message: string }) {
  return (
    <div className="animate-rise rounded-xl border border-ok/30 bg-ok/5 p-4">
      <p className="flex items-center gap-2 font-semibold text-ok">
        <CircleCheck className="size-5" /> Shortage resolved
      </p>
      <p className="mt-1.5 text-sm">{message}</p>
      <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
        {['Part transfer requested', 'Bay assigned', 'Technician assigned', 'Customer status updated'].map((s) => (
          <li key={s} className="flex items-center gap-2">
            <Check className="size-4 text-ok" strokeWidth={3} /> {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
