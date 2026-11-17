import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BatteryLow, CalendarClock, Check, Hourglass, MapPin, Package, Siren, Timer, UserRound, Wrench, Zap } from 'lucide-react';
import type { Alert } from '../types';
import { api, errorMessage } from '../services/api';
import { useToast } from '../context/ToastContext';
import { cn, timeAgo } from '../utils/format';
import { Badge, Button } from './ui';
import { StockTag } from './StockTag';

const TYPE_ICON: Record<string, typeof Siren> = {
  INSPECTION: Siren,
  AGING: Hourglass,
  PARTS_SHORTAGE: Package,
  SCHEDULING: CalendarClock,
  SERVICE_DELAY: Timer,
  LOT_ACCURACY: MapPin,
  BATTERY: BatteryLow,
  URGENT_REPAIR: Wrench,
  CUSTOMER: UserRound,
};
const RULE: Record<string, string> = { CRITICAL: 'bg-bad', HIGH: 'bg-warn', MEDIUM: 'bg-brand', LOW: 'bg-hold' };
const TONE = { CRITICAL: 'bad', HIGH: 'warn', MEDIUM: 'brand', LOW: 'neutral' } as const;
const PRIORITY_LABEL = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

/** An AI-generated alert with its recommended action. "Apply" runs the real workflow. */
export function AlertCard({ alert, onApplied, detailed, fresh }: { alert: Alert; onApplied?: (message: string) => void; detailed?: boolean; fresh?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(alert.status === 'RESOLVED' ? alert.resolution?.note || 'Handled' : null);
  const { push } = useToast();
  const Icon = TYPE_ICON[alert.type] || Zap;

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applyAction(alert._id);
      setResult(r.message);
      push({ title: 'Action applied', message: r.message, kind: 'success' });
      onApplied?.(r.message);
    } catch (err) {
      push({ title: 'Could not apply the action', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await api.updateAlert(alert._id, 'DISMISSED');
      setResult('Dismissed');
      onApplied?.('Dismissed');
    } catch (err) {
      push({ title: 'Could not dismiss', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={cn('relative flex overflow-hidden rounded-xl border border-line bg-surface transition-shadow', fresh && 'animate-rise ring-2 ring-paint/70')}>
      <span className={cn('w-1 shrink-0', result ? 'bg-ok' : RULE[alert.priority])} />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', result ? 'bg-ok/12 text-ok' : alert.priority === 'CRITICAL' ? 'bg-bad/12 text-bad' : alert.priority === 'HIGH' ? 'bg-warn/12 text-warn' : 'bg-brand/10 text-brand dark:text-brand-2')}>
            {result ? <Check className="size-5" /> : <Icon className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold leading-snug">{alert.title}</h3>
              {detailed && <Badge tone={TONE[alert.priority]}>{PRIORITY_LABEL[alert.priority]}</Badge>}
              {fresh && <Badge tone="paint">New</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">{alert.description}</p>

            {alert.type === 'AGING' && alert.details?.reasons && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {alert.details.reasons.map((r) => (
                  <li key={r} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted ring-1 ring-line ring-inset">
                    {r}
                  </li>
                ))}
              </ul>
            )}
            {alert.type === 'PARTS_SHORTAGE' && alert.details?.stores && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {alert.details.stores.map((s) => (
                  <span key={s.code} className={cn('t-num rounded-md px-2 py-0.5 text-xs ring-1 ring-inset', s.qty > 0 ? 'bg-ok/10 text-ok ring-ok/25' : 'bg-surface-2 text-muted ring-line')}>
                    {s.name || s.code}: {s.qty}
                  </span>
                ))}
              </div>
            )}

            {detailed && alert.reason && (
              <p className="mt-3 text-sm">
                <span className="text-faint">Reason: </span>
                {alert.reason}
              </p>
            )}
            {!result && alert.recommendedAction && (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm ring-1 ring-line ring-inset">
                <span className="font-medium">Recommended: </span>
                {alert.recommendedAction}
              </p>
            )}
            {detailed && !result && alert.expectedImpact && (
              <p className="mt-2 text-sm text-muted">
                <span className="text-faint">Expected impact: </span>
                {alert.expectedImpact}
              </p>
            )}
            {result && <p className="mt-2 rounded-lg bg-ok/8 px-3 py-2 text-sm text-ink ring-1 ring-ok/25 ring-inset">{result}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {alert.vehicleId && <StockTag id={alert.vehicleId} size="sm" link />}
              <span className="text-xs text-faint">{timeAgo(alert.createdAt)}</span>
              <span className="flex-1" />
              {!result && alert.type === 'AGING' && (
                <Link to={`/analytics#v-${alert.vehicleId}`} className="text-sm font-medium text-brand hover:underline dark:text-brand-2">
                  View explanation
                </Link>
              )}
              {!result && alert.actionType && (
                <>
                  {detailed && (
                    <Button size="sm" variant="ghost" onClick={dismiss} disabled={busy}>
                      Dismiss
                    </Button>
                  )}
                  <Button size="sm" onClick={apply} loading={busy}>
                    {detailed ? 'Apply' : alert.actionLabel || 'Take action'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
