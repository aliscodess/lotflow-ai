import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Map, Sparkles } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { api } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { Button, ErrorState, PageHeader, PageSkeleton, Panel, EmptyState } from '../components/ui';
import { AlertCard } from '../components/AlertCard';
import { Timeline } from '../components/Timeline';
import { StockTag } from '../components/StockTag';
import { cn, greeting, VEHICLE_STATUS, bayName } from '../utils/format';
import type { VehicleStatus } from '../types';

function HealthBand({ k }: { k: { totalVehicles: number; healthy: number; attention: number; critical: number } }) {
  const total = Math.max(1, k.healthy + k.attention + k.critical);
  const segs = [
    { key: 'healthy', label: 'Healthy', value: k.healthy, color: 'var(--color-ok)' },
    { key: 'attention', label: 'Needs attention', value: k.attention, color: 'var(--color-warn)' },
    { key: 'critical', label: 'Critical', value: k.critical, color: 'var(--color-bad)' },
  ];
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="grid gap-6 md:grid-cols-[220px_1fr] md:items-center">
        <div>
          <p className="text-sm text-muted">Total vehicles</p>
          <p className="t-display t-num mt-1 text-[56px] leading-none">{k.totalVehicles}</p>
          <p className="mt-2 text-sm text-faint">On the Whitefield lot, excluding sold</p>
        </div>
        <div>
          <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${k.healthy} healthy, ${k.attention} need attention, ${k.critical} critical`}>
            {segs.map((s) => (
              <span key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="h-full transition-[width] duration-700 first:rounded-l-full last:rounded-r-full" />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {segs.map((s) => (
              <Link key={s.key} to={s.key === 'critical' ? '/lot?filter=CRITICAL' : '/vehicles'} className="group rounded-xl p-2 -m-2 hover:bg-surface-2">
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="t-num mt-1 block text-3xl font-semibold">{s.value}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { connected } = useRealtime();
  const dash = useApi(() => api.dashboard(), []);
  const board = useApi(() => api.board(), []);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  useLiveRefresh(['alert:new', 'alert:updated', 'vehicle:updated', 'activity:new', 'service:updated', 'dashboard:refresh', 'system:reset'], dash.refetch);
  useLiveRefresh(['service:updated', 'system:reset'], board.refetch);

  // Highlight alerts that arrived after the page loaded.
  useEffect(() => {
    if (!dash.data) return;
    const ids = dash.data.alerts.map((a) => a._id);
    if (known.current === null) {
      known.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !known.current!.has(id));
    if (added.length) {
      setFreshIds((s) => new Set([...s, ...added]));
      added.forEach((id) => known.current!.add(id));
    }
  }, [dash.data]);

  if (dash.loading) return <PageSkeleton />;
  if (dash.error || !dash.data) return <ErrorState message={dash.error || 'No data'} onRetry={dash.retry} />;
  const { kpis, alerts, activity, agingBuckets, statusCounts } = dash.data;
  const ordered = [...alerts].sort((a, b) => Number(freshIds.has(b._id)) - Number(freshIds.has(a._id)));

  const metrics = [
    { label: "Today's inspections", value: kpis.inspectionsToday, note: `${kpis.openInspections} open`, to: '/service' },
    { label: 'Service jobs', value: kpis.serviceJobs, note: `${kpis.completedToday} completed today`, to: '/service' },
    { label: 'Avg days in inventory', value: kpis.avgDaysInInventory, note: `${kpis.agingVehicles} past expected`, to: '/analytics' },
    { label: 'Lot accuracy', value: `${kpis.lotAccuracy}%`, note: 'Verified in last 4 days', to: '/lot' },
    { label: 'Service delays', value: `${kpis.serviceDelayRate}%`, note: `${kpis.serviceDelays} jobs late or blocked`, to: '/service', bad: kpis.serviceDelayRate > 12 },
  ];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${user?.name.split(' ')[0]}`}
        description={
          <span className="inline-flex items-center gap-2">
            <span className={cn('size-2 rounded-full', connected ? 'bg-ok' : 'bg-warn')} />
            {connected ? 'Live: updates from the lot and service bays appear as they happen.' : 'Reconnecting to live updates. Data refreshes every 20 seconds.'}
          </span>
        }
        actions={
          <>
            <Link to="/lot">
              <Button variant="secondary" icon={<Map className="size-4" />}>
                Lot map
              </Button>
            </Link>
            <Link to="/actions">
              <Button icon={<Sparkles className="size-4" />}>{kpis.actionable} AI actions</Button>
            </Link>
          </>
        }
      />

      <HealthBand k={kpis} />

      <section className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((m, i) => (
          <Link key={m.label} to={m.to} className={cn('bg-surface p-4 transition-colors hover:bg-surface-2 sm:p-5', i === metrics.length - 1 && 'max-sm:col-span-2')}>
            <p className="text-[13px] text-muted">{m.label}</p>
            <p className={cn('t-num mt-1.5 text-2xl font-semibold', m.bad && 'text-bad')}>{m.value}</p>
            <p className="mt-1 text-xs text-faint">{m.note}</p>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="AI alerts"
          subtitle="Detected from lot walks, service bays, parts and inventory data"
          actions={
            <Link to="/actions" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline dark:text-brand-2">
              All actions <ArrowRight className="size-4" />
            </Link>
          }
          bodyClassName="space-y-3"
        >
          {ordered.length === 0 ? (
            <EmptyState title="No open alerts" message="New inspections, shortages and delays show up here the moment they are detected." />
          ) : (
            ordered.slice(0, 6).map((a) => <AlertCard key={a._id} alert={a} fresh={freshIds.has(a._id)} onApplied={() => setTimeout(dash.refetch, 600)} />)
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title="Service bays" actions={<Link to="/service" className="text-sm font-medium text-brand hover:underline dark:text-brand-2">Open</Link>} bodyClassName="p-3">
            {board.data ? (
              <ul className="space-y-1">
                {board.data.bays.map((b) => (
                  <li key={b.code} className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <span className="w-12 text-sm font-semibold">{bayName(b.code)}</span>
                    <span className={cn('size-2 rounded-full', b.status === 'OCCUPIED' ? 'bg-svc' : b.status === 'BLOCKED' ? 'bg-warn' : b.status === 'RESERVED' ? 'bg-brand' : 'bg-ok')} />
                    {b.current ? (
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <StockTag id={b.current.vehicleId} size="sm" link />
                        <span className="truncate text-sm text-muted">{b.current.technicianName}</span>
                      </span>
                    ) : (
                      <span className="flex-1 text-sm text-ok">Available</span>
                    )}
                    {b.current?.overrun ? <span className="text-xs text-bad">+{b.current.overrun} min</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted">{board.error || 'Loading bays…'}</p>
            )}
          </Panel>

          <Panel title="Live activity" bodyClassName="max-h-[460px] overflow-y-auto scrollbar-thin">
            <Timeline items={activity} showVehicle compact />
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Inventory age" subtitle="Vehicles by days in stock">
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={agingBuckets} margin={{ left: -20, right: 8, top: 8 }}>
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} />
                <Bar dataKey="count" name="Vehicles" radius={[6, 6, 0, 0]}>
                  {agingBuckets.map((_, i) => (
                    <Cell key={i} fill={i >= 2 ? 'var(--color-warn)' : 'var(--color-brand)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Status breakdown" subtitle="Inventory by current status">
          <ul className="space-y-3">
            {(Object.keys(VEHICLE_STATUS) as VehicleStatus[])
              .filter((s) => s !== 'SOLD')
              .map((s) => {
                const v = statusCounts[s] || 0;
                return (
                  <li key={s}>
                    <Link to={`/vehicles?status=${s}`} className="flex items-center gap-3 rounded-lg hover:bg-surface-2">
                      <span className="w-40 text-sm">{VEHICLE_STATUS[s].label}</span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span className="block h-full rounded-full" style={{ width: `${(v / Math.max(1, kpis.totalVehicles)) * 100}%`, background: VEHICLE_STATUS[s].color }} />
                      </span>
                      <span className="t-num w-8 text-right text-sm font-semibold">{v}</span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
