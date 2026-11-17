import { Check, CircleAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from './ui';
import { cn, healthColor, PRIORITY, TASK_STATUS, VEHICLE_STATUS } from '../utils/format';
import type { HealthItem, Priority, ServiceStep, TaskStatus, VehicleStatus } from '../types';

export function StatusBadge({ status }: { status: VehicleStatus }) {
  const s = VEHICLE_STATUS[status] || VEHICLE_STATUS.AVAILABLE;
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export function TaskBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS[status] || TASK_STATUS.SCHEDULED;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const p = PRIORITY[priority] || PRIORITY.MEDIUM;
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

/** Top-down car silhouette used on the lot map. */
export function CarGlyph({ color, flip, dim, className }: { color: string; flip?: boolean; dim?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 40 72" className={cn('drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)]', flip && 'rotate-180', dim && 'opacity-25', className)} aria-hidden="true">
      <rect x="4" y="3" width="32" height="66" rx="11" fill={color} />
      <rect x="4" y="3" width="32" height="66" rx="11" fill="url(#carShade)" />
      <path d="M9 21 Q20 15 31 21 L29 31 Q20 28 11 31 Z" fill="#0b0f13" opacity=".78" />
      <path d="M10 54 Q20 58 30 54 L29 47 Q20 49 11 47 Z" fill="#0b0f13" opacity=".7" />
      <rect x="10" y="32" width="20" height="14" rx="3" fill="#000" opacity=".12" />
      <rect x="1.5" y="22" width="3.5" height="5" rx="1.5" fill={color} />
      <rect x="35" y="22" width="3.5" height="5" rx="1.5" fill={color} />
      <defs>
        <linearGradient id="carShade" x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".25" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Side-profile placeholder for vehicles without uploaded photos. */
export function PhotoPlaceholder({ label, type = 'SUV' }: { label: string; type?: string }) {
  const tall = type === 'SUV' || type === 'MUV';
  return (
    <div className="relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-b from-surface-2 to-surface p-2.5 ring-1 ring-line ring-inset">
      <svg viewBox="0 0 120 50" className="mx-auto mt-3 w-4/5 text-faint" aria-hidden="true">
        <path
          d={tall ? 'M8 38 L10 26 Q12 20 22 19 L36 10 Q42 7 52 7 L84 7 Q92 7 98 14 L104 20 Q114 22 114 30 L114 38 Z' : 'M6 38 L8 30 Q10 24 20 23 L38 13 Q44 10 54 10 L80 10 Q88 10 96 17 L102 23 Q114 25 114 32 L114 38 Z'}
          fill="currentColor"
          opacity=".35"
        />
        <circle cx="30" cy="39" r="8" fill="currentColor" opacity=".55" />
        <circle cx="92" cy="39" r="8" fill="currentColor" opacity=".55" />
      </svg>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

export function HealthRing({ score, size = 96, stroke = 9, children }: { score: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={healthColor(score)}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className="t-num text-2xl font-bold">{score}</span>}</div>
    </div>
  );
}

const HEALTH_LABELS: Record<string, string> = { location: 'Location', condition: 'Condition', photos: 'Photos', listing: 'Listing', service: 'Service' };

export function HealthBreakdown({ breakdown }: { breakdown: Record<string, HealthItem> }) {
  return (
    <ul className="divide-y divide-line">
      {Object.entries(breakdown || {}).map(([key, item]) => (
        <li key={key} className="flex items-center gap-3 py-2.5">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', item.status === 'ok' ? 'bg-ok/15 text-ok' : item.status === 'warn' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad')}>
            {item.status === 'ok' ? <Check className="size-3.5" strokeWidth={3} /> : item.status === 'warn' ? <TriangleAlert className="size-3.5" /> : <CircleAlert className="size-3.5" />}
          </span>
          <span className="w-20 shrink-0 text-sm font-medium">{HEALTH_LABELS[key] || key}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted" title={item.note}>
            {item.note}
          </span>
          <span className="t-num shrink-0 text-xs text-faint">
            {item.score}/{item.max}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Customer-facing service progress (vertical). */
export function ServiceSteps({ steps, onSelect, compact }: { steps: ServiceStep[]; onSelect?: (key: string) => void; compact?: boolean }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const content = (
          <>
            <span className="relative flex flex-col items-center">
              <span
                className={cn(
                  'z-10 grid size-6 place-items-center rounded-full ring-2',
                  s.status === 'done' && 'bg-ok text-white ring-ok',
                  s.status === 'current' && 'bg-surface ring-brand',
                  s.status === 'pending' && 'bg-surface ring-line',
                )}
              >
                {s.status === 'done' && <Check className="size-3.5" strokeWidth={3} />}
                {s.status === 'current' && <span className="size-2.5 animate-pulse rounded-full bg-brand" />}
              </span>
              {!last && <span className={cn('absolute top-6 h-full w-0.5', s.status === 'done' ? 'bg-ok/60' : 'bg-line')} />}
            </span>
            <span className={cn('min-w-0 pb-5', compact && 'pb-3.5')}>
              <span className={cn('block text-sm', s.status === 'pending' ? 'text-faint' : 'font-medium', s.status === 'current' && 'text-brand dark:text-brand-2')}>{s.label}</span>
            </span>
          </>
        );
        return (
          <li key={s.key}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(s.key)} className="grid w-full grid-cols-[24px_1fr] gap-3 rounded-lg text-left hover:bg-surface-2/60" title={`Set stage: ${s.label}`}>
                {content}
              </button>
            ) : (
              <div className="grid grid-cols-[24px_1fr] gap-3">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
