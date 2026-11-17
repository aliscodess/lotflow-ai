import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleHelp, Mic, Search, Wrench } from 'lucide-react';
import { api } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Button, Drawer, ErrorState, Input, PageHeader, PageSkeleton, Segmented, Panel } from '../components/ui';
import { CarGlyph, HealthRing, StatusBadge } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { cn, timeAgo, VEHICLE_STATUS } from '../utils/format';
import type { LotSlot, LotVehicle } from '../types';

type Filter = 'ALL' | 'AVAILABLE' | 'INSPECTION_REQUIRED' | 'SERVICE' | 'CRITICAL';

const matches = (v: LotVehicle, f: Filter) => (f === 'ALL' ? true : f === 'CRITICAL' ? v.critical : v.status === f);
const CONDITION_LABEL: Record<string, string> = { exterior: 'Exterior', interior: 'Interior', tires: 'Tyres', fuel: 'Fuel', battery: 'Battery', mechanical: 'Mechanical' };

function Stall({ slot, flip, filter, selected, highlight, onSelect }: { slot: LotSlot; flip?: boolean; filter: Filter; selected: boolean; highlight: boolean; onSelect: (v: LotVehicle) => void }) {
  const v = slot.vehicle;
  const on = v ? matches(v, filter) : false;
  return (
    <div className={cn('relative flex h-[104px] flex-col items-center border-l-2 border-chalk/60 px-1 last:border-r-2', flip ? 'justify-end pb-1.5' : 'justify-start pt-1.5')}>
      {v ? (
        <button
          type="button"
          onClick={() => onSelect(v)}
          title={`#${v.vehicleId} · ${v.year} ${v.make} ${v.model} · ${VEHICLE_STATUS[v.status].label}`}
          className={cn('group relative flex flex-col items-center rounded-lg px-1 pt-0.5 transition-transform', flip ? 'flex-col-reverse' : '', selected ? 'ring-2 ring-paint' : 'hover:-translate-y-0.5', highlight && 'ring-2 ring-white')}
        >
          <CarGlyph color={VEHICLE_STATUS[v.status].color} flip={flip} dim={!on} className="h-[66px] w-[38px]" />
          <span className={cn('t-condensed t-num my-0.5 rounded-[3px] px-1 text-[11px] font-extrabold leading-[15px]', on ? 'bg-paint text-asphalt' : 'bg-white/10 text-white/40')}>{v.vehicleId}</span>
          {v.critical && on && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-bad ring-2 ring-asphalt" aria-label="Critical" />}
          {v.auditRequested && <CircleHelp className="absolute -top-1.5 -left-1.5 size-4 rounded-full bg-asphalt text-paint" aria-label="Location check requested" />}
        </button>
      ) : (
        <span className={cn('t-condensed mt-8 text-sm font-bold text-chalk/25', flip && 'mt-0 mb-8')}>{slot.code}</span>
      )}
    </div>
  );
}

function RowStrip({ row, label, slots, flip, ...rest }: { row: string; label: string; slots: LotSlot[]; flip?: boolean; filter: Filter; selectedId?: string; highlightId?: string; onSelect: (v: LotVehicle) => void }) {
  return (
    <div className="flex items-stretch gap-3">
      <div className="flex w-16 shrink-0 flex-col justify-center">
        <span className="t-display text-2xl text-chalk">{row}</span>
        <span className="text-[10px] leading-tight text-chalk/50">{label}</span>
      </div>
      <div className="grid flex-1 grid-cols-12">
        {slots.map((s) => (
          <Stall key={s.code} slot={s} flip={flip} filter={rest.filter} selected={rest.selectedId === s.vehicle?.vehicleId} highlight={rest.highlightId === s.vehicle?.vehicleId} onSelect={rest.onSelect} />
        ))}
      </div>
    </div>
  );
}

function Lane() {
  return (
    <div className="my-1 flex items-center gap-3 py-4" aria-hidden="true">
      <span className="w-16 shrink-0" />
      <div className="flex flex-1 items-center gap-4">
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} className="h-[3px] flex-1 rounded bg-paint/70" />
        ))}
      </div>
    </div>
  );
}

export default function LotMapPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const lot = useApi(() => api.lot(), []);
  useLiveRefresh(['vehicle:updated', 'system:reset'], lot.refetch);
  const [filter, setFilter] = useState<Filter>(((params.get('filter') as Filter) || 'ALL'));
  const [selected, setSelected] = useState<LotVehicle | null>(null);
  const [query, setQuery] = useState('');

  const found = useMemo(() => {
    if (!query || !lot.data) return null;
    const all = [...lot.data.rows.flatMap((r) => r.slots.map((s) => s.vehicle).filter(Boolean)), ...lot.data.serviceArea] as LotVehicle[];
    return all.find((v) => v.vehicleId.startsWith(query.trim().replace('#', ''))) || null;
  }, [query, lot.data]);

  if (lot.loading) return <PageSkeleton />;
  if (lot.error || !lot.data) return <ErrorState message={lot.error || 'No data'} onRetry={lot.retry} />;
  const { rows, counts, serviceArea, unplaced } = lot.data;
  const pairs = [rows.slice(0, 2), rows.slice(2, 4), rows.slice(4, 6)];
  const current = selected ? ([...rows.flatMap((r) => r.slots.map((s) => s.vehicle)), ...serviceArea].find((v) => v?.vehicleId === selected.vehicleId) as LotVehicle | undefined) || selected : null;

  return (
    <div>
      <PageHeader
        title="Lot"
        description="Live map of the Whitefield lot. Positions update as associates report them by voice."
        actions={
          (user?.role === 'LOT_ASSOCIATE' || user?.role === 'MANAGER') && (
            <Link to="/voice">
              <Button variant="paint" icon={<Mic className="size-4" />}>
                Report by voice
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setParams(f === 'ALL' ? {} : { filter: f });
          }}
          options={[
            { value: 'ALL', label: 'All', count: counts.total },
            { value: 'AVAILABLE', label: 'Available', count: counts.AVAILABLE },
            { value: 'INSPECTION_REQUIRED', label: 'Inspection', count: counts.INSPECTION_REQUIRED },
            { value: 'SERVICE', label: 'Service', count: counts.SERVICE },
            { value: 'CRITICAL', label: 'Critical', count: counts.CRITICAL },
          ]}
        />
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && found && setSelected(found)}
            placeholder="Find stock number"
            className="pl-9"
            aria-label="Find stock number"
          />
          {query && (
            <p className="absolute mt-1 text-xs text-muted">
              {found ? (
                <button type="button" className="font-medium text-brand dark:text-brand-2" onClick={() => setSelected(found)}>
                  #{found.vehicleId} at {found.location.zone === 'SERVICE' ? 'service area' : `${found.location.row}${found.location.position}`} · open
                </button>
              ) : (
                'No match on this lot'
              )}
            </p>
          )}
        </div>
        <div className="ml-auto hidden flex-wrap items-center gap-3 text-xs text-muted xl:flex">
          {(['AVAILABLE', 'INSPECTION_REQUIRED', 'SERVICE', 'HOLD', 'SOLD'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: VEHICLE_STATUS[s].color }} />
              {VEHICLE_STATUS[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-bad" /> Critical
          </span>
        </div>
      </div>

      <div className="asphalt overflow-x-auto rounded-2xl p-4 ring-1 ring-black/30 scrollbar-thin sm:p-6">
        <div className="min-w-[880px]">
          <div className="mb-4 flex items-center gap-3">
            <span className="w-16 shrink-0" />
            <div className="flex-1 rounded-md bg-white/[0.05] py-2 text-center text-xs text-chalk/60 ring-1 ring-white/10">Showroom frontage · Main gate on ITPL Road</div>
          </div>
          {pairs.map((pair, i) => (
            <div key={i}>
              <RowStrip {...pair[0]} filter={filter} selectedId={current?.vehicleId} highlightId={found?.vehicleId} onSelect={setSelected} />
              <div className="ml-[76px] h-0.5 bg-chalk/60" />
              <RowStrip {...pair[1]} flip filter={filter} selectedId={current?.vehicleId} highlightId={found?.vehicleId} onSelect={setSelected} />
              {i < pairs.length - 1 && <Lane />}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-faint">{counts.emptySlots} empty stalls. Scroll sideways on smaller screens.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Service area" subtitle="Vehicles currently with the workshop" bodyClassName="p-3">
          <ul className="grid gap-1 sm:grid-cols-2">
            {serviceArea.map((v) => (
              <li key={v.vehicleId}>
                <button type="button" onClick={() => setSelected(v)} className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2', !matches(v, filter) && 'opacity-40')}>
                  <StockTag id={v.vehicleId} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {v.year} {v.make} {v.model}
                  </span>
                  <Wrench className="size-4 text-svc" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        {unplaced.length > 0 && (
          <Panel title="Needs a location check" subtitle="Slot reassigned or never recorded" bodyClassName="p-3">
            <ul className="space-y-1">
              {unplaced.map((v) => (
                <li key={v.vehicleId}>
                  <button type="button" onClick={() => setSelected(v)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                    <StockTag id={v.vehicleId} size="sm" />
                    <span className="text-sm">
                      {v.year} {v.make} {v.model}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <Drawer
        open={Boolean(current)}
        onClose={() => setSelected(null)}
        title={
          current && (
            <span className="flex items-center gap-2">
              <span className="t-title">{current.location.zone === 'SERVICE' ? 'Service area' : `${current.location.row ?? '—'}${current.location.position ?? ''}`}</span>
            </span>
          )
        }
      >
        {current && (
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <StockTag id={current.vehicleId} size="xl" />
                <p className="t-title mt-3 text-lg">
                  {current.year} {current.make} {current.model}
                </p>
                <p className="text-sm text-muted">
                  {current.variant} · {current.type} · {current.color}
                </p>
                <div className="mt-3">
                  <StatusBadge status={current.status} />
                </div>
              </div>
              <HealthRing score={current.healthScore} size={84} stroke={8}>
                <span>
                  <span className="t-num block text-xl font-bold">{current.healthScore}</span>
                  <span className="block text-[10px] text-muted">health</span>
                </span>
              </HealthRing>
            </div>

            <div className="mt-5 rounded-xl border border-line">
              {current.issues.length ? (
                <ul className="divide-y divide-line">
                  {current.issues.map((i) => (
                    <li key={i.key} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', i.status === 'POOR' ? 'bg-bad' : 'bg-warn')} />
                      <span>
                        <span className="block text-sm font-medium">{CONDITION_LABEL[i.key] || i.key}</span>
                        <span className="block text-sm text-muted">{i.notes || i.status.toLowerCase()}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-muted">No open condition issues.</p>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-faint">Days in inventory</dt>
                <dd className="t-num mt-0.5 font-medium">{current.daysInInventory ?? '—'} {current.daysInInventory !== null && <span className="text-faint">/ {current.expectedDaysToSell} expected</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Last seen</dt>
                <dd className="mt-0.5 font-medium">{timeAgo(current.lastSeenAt) || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Fuel</dt>
                <dd className="mt-0.5 font-medium capitalize">{current.fuelType.toLowerCase()}</dd>
              </div>
              <div>
                <dt className="text-xs text-faint">Ownership</dt>
                <dd className="mt-0.5 font-medium">{current.ownership === 'CUSTOMER' ? 'Customer vehicle' : 'Inventory'}</dd>
              </div>
            </dl>
            {current.auditRequested && <p className="mt-4 rounded-lg bg-paint/10 px-3 py-2 text-sm ring-1 ring-paint/30">A location check has been requested for this vehicle.</p>}

            <div className="mt-6 flex flex-wrap gap-2">
              <Link to={`/vehicles/${current.vehicleId}`}>
                <Button icon={<ArrowRight className="size-4" />}>Open vehicle</Button>
              </Link>
              {(user?.role === 'LOT_ASSOCIATE' || user?.role === 'MANAGER') && (
                <Link to="/voice">
                  <Button variant="secondary" icon={<Mic className="size-4" />}>
                    Report by voice
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
