import { Bot, CalendarClock, Camera, Car, CircleDot, MapPin, Mic, Package, Siren, Tag, UserRound, Wrench } from 'lucide-react';
import type { Activity } from '../types';
import { clock, cn, timeAgo } from '../utils/format';
import { StockTag } from './StockTag';

const ICONS: Record<string, typeof Car> = {
  LOCATION: MapPin,
  CONDITION: Car,
  INSPECTION: Siren,
  SERVICE: Wrench,
  SCHEDULE: CalendarClock,
  PART: Package,
  PHOTO: Camera,
  CUSTOMER: UserRound,
  LISTING: Tag,
  ALERT: Bot,
  STATUS: CircleDot,
  STOCK: Car,
};

export function Timeline({ items, showVehicle, compact, empty = 'No activity yet.' }: { items: Activity[]; showVehicle?: boolean; compact?: boolean; empty?: string }) {
  if (!items?.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ol className="relative">
      {items.map((a, i) => {
        const Icon = a.source === 'VOICE' ? Mic : ICONS[a.type] || CircleDot;
        return (
          <li key={a._id || i} className="animate-rise grid grid-cols-[28px_1fr] gap-3">
            <span className="relative flex flex-col items-center">
              <span className={cn('z-10 grid size-7 place-items-center rounded-full ring-1 ring-inset', a.source === 'VOICE' ? 'bg-paint/15 text-[#9a7600] ring-paint/40 dark:text-paint' : a.source === 'AI' ? 'bg-brand/10 text-brand ring-brand/25 dark:text-brand-2' : 'bg-surface-2 text-muted ring-line')}>
                <Icon className="size-3.5" />
              </span>
              {i < items.length - 1 && <span className="absolute top-7 h-full w-px bg-line" />}
            </span>
            <div className={cn('min-w-0', compact ? 'pb-3' : 'pb-4')}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {showVehicle && a.vehicleId && <StockTag id={a.vehicleId} size="sm" link />}
                <p className="text-sm leading-snug">{a.message}</p>
              </div>
              <p className="mt-0.5 text-xs text-faint">
                <span className="t-num">{clock(a.createdAt)}</span> · {timeAgo(a.createdAt)}
                {a.actor?.name ? ` · ${a.actor.name}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
