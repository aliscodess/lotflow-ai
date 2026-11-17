import { ArrowDown, Fuel, Leaf, Route, Truck, Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { ErrorState, Meter, PageHeader, PageSkeleton, Panel } from '../components/ui';
import { HealthRing } from '../components/VehicleBits';
import { dayClock, inr } from '../utils/format';

export default function SustainabilityPage() {
  const s = useApi(() => api.sustainability(), []);
  useLiveRefresh(['parts:updated', 'service:updated', 'system:reset'], s.refetch);
  if (s.loading) return <PageSkeleton />;
  if (s.error || !s.data) return <ErrorState message={s.error || 'No data'} onRetry={s.retry} />;
  const { score, metrics, breakdown, trend, recommendations, transferGroups } = s.data;

  const tiles = [
    { icon: Route, label: 'Avoidable vehicle movement', value: `${metrics.avoidableMovementKm} km`, note: 'per month, identified from lot and transfer logs' },
    { icon: Fuel, label: 'Estimated fuel savings', value: inr(metrics.fuelSavingsINR), note: 'per month if avoided' },
    { icon: ArrowDown, label: 'Idle service time', value: `↓ ${metrics.idleReductionPct}%`, note: 'since AI dispatch went live' },
    { icon: Zap, label: 'EV utilisation', value: `${metrics.evUtilizationPct}%`, note: 'of loaner kilometres driven on EVs' },
  ];

  return (
    <div>
      <PageHeader title="Sustainability" description="Operational efficiency that also cuts fuel, emissions and energy. Built from the same lot, service and parts data." />

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Panel>
          <div className="flex flex-col items-center text-center">
            <p className="text-sm text-muted">Green dealership score</p>
            <div className="mt-4">
              <HealthRing score={score} size={168} stroke={14}>
                <span>
                  <span className="t-display t-num block text-5xl">{score}</span>
                  <span className="text-sm text-muted">/ 100</span>
                </span>
              </HealthRing>
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-sm text-ok">
              <Leaf className="size-4" /> {metrics.co2AvoidedKg} kg CO₂ avoidable each month
            </p>
          </div>
          <ul className="mt-6 space-y-3">
            {breakdown.map((b) => (
              <li key={b.key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{b.label}</span>
                  <span className="t-num font-medium">{b.score}</span>
                </div>
                <Meter value={b.score} color={b.score >= 80 ? 'var(--color-ok)' : 'var(--color-warn)'} />
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-6">
          <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {tiles.map((t) => (
              <div key={t.label} className="bg-surface p-5">
                <t.icon className="size-5 text-ok" />
                <p className="mt-3 text-sm text-muted">{t.label}</p>
                <p className="t-num mt-1 text-3xl font-semibold">{t.value}</p>
                <p className="mt-1 text-xs text-faint">{t.note}</p>
              </div>
            ))}
          </section>
          <Panel title="Score trend" subtitle="Whitefield, last 6 months">
            <div className="h-52">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ left: -18, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[60, 90]} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }} />
                  <Line type="monotone" dataKey="score" name="Green score" stroke="var(--color-ok)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Recommendations" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {recommendations.map((r) => (
              <li key={r.key} className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.detail}</p>
                </div>
                <p className="shrink-0 text-sm font-medium text-ok sm:max-w-48 sm:text-right">{r.impact}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Pending part transfers" subtitle="Grouped by source store" bodyClassName="p-0">
          {transferGroups.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No transfers pending.</p>
          ) : (
            <ul className="divide-y divide-line">
              {transferGroups.map((g) => (
                <li key={g.fromStore} className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Truck className="size-4 text-faint" />
                    <span className="font-medium">From {g.storeName}</span>
                    <span className="text-sm text-faint">· {g.distanceKm} km</span>
                    <span className="flex-1" />
                    {g.count > 1 && <span className="rounded-md bg-ok/12 px-2 py-0.5 text-xs font-medium text-ok">Combine into 1 trip</span>}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {g.transfers.map((t) => (
                      <li key={t.transferId}>
                        {t.transferId}: {t.partName}, ETA {dayClock(t.eta)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
