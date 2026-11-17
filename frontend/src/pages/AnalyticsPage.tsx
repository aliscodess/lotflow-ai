import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Lightbulb, Sparkles } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage, type AgingItem } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Badge, Button, EmptyState, ErrorState, PageHeader, PageSkeleton, Panel, Spinner } from '../components/ui';
import { StockTag } from '../components/StockTag';
import { cn } from '../utils/format';

const STORE_COLORS = ['var(--color-brand)', 'var(--color-warn)', 'var(--color-ok)'];
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' };

function AgingRow({ item, open, onToggle, onApplied }: { item: AgingItem; open: boolean; onToggle: () => void; onApplied: () => void }) {
  const [explain, setExplain] = useState<AgingItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    if (!open || explain) return;
    setLoading(true);
    api
      .agingExplain(item.vehicleId)
      .then(setExplain)
      .catch((err) => push({ title: 'Could not load the explanation', message: errorMessage(err), kind: 'error' }))
      .finally(() => setLoading(false));
  }, [open, explain, item.vehicleId, push]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.agingPlaybook(item.vehicleId);
      push({ title: 'Playbook started', message: r.message, kind: 'success' });
      onApplied();
    } catch (err) {
      push({ title: 'Could not start the playbook', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const pct = Math.min(100, (item.daysInInventory / Math.max(item.daysInInventory, item.expectedDaysToSell * 1.6)) * 100);
  const expectedPct = Math.min(100, (item.expectedDaysToSell / Math.max(item.daysInInventory, item.expectedDaysToSell * 1.6)) * 100);
  const data = explain || item;

  return (
    <li id={`v-${item.vehicleId}`} className={cn('rounded-xl border bg-surface transition-colors', open ? 'border-brand/50' : 'border-line')}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-4 text-left" aria-expanded={open}>
        <StockTag id={item.vehicleId} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{item.label}</span>
          <span className="block text-xs text-muted">
            {item.variant} · parked at {item.location}
          </span>
        </span>
        <span className="w-full sm:w-56">
          <span className="flex justify-between text-xs text-muted">
            <span className="t-num">
              <span className={cn('font-semibold', item.overBy > 0 ? 'text-warn' : 'text-ink')}>{item.daysInInventory} days</span> in inventory
            </span>
            <span className="t-num">expected {item.expectedDaysToSell}</span>
          </span>
          <span className="relative mt-1.5 block h-2 rounded-full bg-surface-2">
            <span className={cn('absolute inset-y-0 left-0 rounded-full', item.risk === 'HIGH' ? 'bg-bad' : item.risk === 'MEDIUM' ? 'bg-warn' : 'bg-brand')} style={{ width: `${pct}%` }} />
            <span className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${expectedPct}%` }} title="Expected days to sell" />
          </span>
        </span>
        <Badge tone={item.risk === 'HIGH' ? 'bad' : item.risk === 'MEDIUM' ? 'warn' : 'neutral'}>Aging risk: {item.risk.toLowerCase()}</Badge>
        <ChevronDown className={cn('size-5 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="animate-rise border-t border-line p-4 sm:p-5">
          {loading && <Spinner />}
          {data.summary && (
            <p className="flex gap-2 text-[15px] leading-relaxed">
              <Sparkles className="mt-1 size-4 shrink-0 text-brand dark:text-brand-2" />
              {data.summary}
            </p>
          )}
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold">Why is this vehicle aging?</p>
              <ul className="mt-2 space-y-2.5">
                {data.reasons.map((r) => (
                  <li key={r.key} className="text-sm">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-muted">{r.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold">Recommendations</p>
              <ul className="mt-2 space-y-2.5">
                {data.recommendations.map((r) => (
                  <li key={r.key} className="flex gap-2 text-sm">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-paint" />
                    <span>
                      <span className="font-medium">{r.title}.</span> <span className="text-muted">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-faint">{data.pricingNote}</p>
              <div className="mt-4">
                {item.playbookApplied ? (
                  <Badge tone="ok">Merchandising playbook in progress</Badge>
                ) : (
                  <Button size="sm" onClick={apply} loading={busy}>
                    Apply merchandising playbook
                  </Button>
                )}
              </div>
            </div>
          </div>
          {explain?.engine && <p className="mt-4 text-xs text-faint">Explanation by {explain.engine}</p>}
        </div>
      )}
    </li>
  );
}

export default function AnalyticsPage() {
  const { hash } = useLocation();
  const aging = useApi(() => api.aging(), []);
  const stores = useApi(() => api.stores(), []);
  useLiveRefresh(['vehicle:updated', 'system:reset'], aging.refetch);
  const [open, setOpen] = useState<string | null>(hash.startsWith('#v-') ? hash.slice(3) : null);

  useEffect(() => {
    if (!open || !aging.data) return;
    setTimeout(() => document.getElementById(`v-${open}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aging.data === null]);

  if (aging.loading) return <PageSkeleton />;
  if (aging.error || !aging.data) return <ErrorState message={aging.error || 'No data'} onRetry={aging.retry} />;
  const { items, summary } = aging.data;

  const metricRows = stores.data
    ? [
        { key: 'lotAccuracy', label: 'Lot accuracy', fmt: (v: number) => `${v}%`, better: 'high' },
        { key: 'avgDaysToSell', label: 'Avg days to sell', fmt: (v: number) => `${v}`, better: 'low' },
        { key: 'serviceDelayRate', label: 'Service delay', fmt: (v: number) => `${v}%`, better: 'low' },
        { key: 'inspectionCompletion', label: 'Inspection completion', fmt: (v: number) => `${v}%`, better: 'high' },
        { key: 'photoCompleteness', label: 'Complete photo sets', fmt: (v: number) => `${v}%`, better: 'high' },
        { key: 'csat', label: 'Customer rating', fmt: (v: number) => `${v} / 5`, better: 'high' },
      ]
    : [];

  return (
    <div>
      <PageHeader title="Analytics" description="Why vehicles are aging, and how each store compares. LotFlow explains the problem; pricing decisions stay with you." />

      <section className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
        {[
          ['Aging vehicles', summary.aging, 'past expected days to sell'],
          ['High risk', summary.highRisk, '35%+ over expected'],
          ['Average overrun', `${summary.avgOverBy} d`, 'beyond expected'],
          ['Avg days in inventory', summary.avgDaysInInventory, 'Whitefield lot'],
        ].map(([l, v, n]) => (
          <div key={String(l)} className="bg-surface p-4 sm:p-5">
            <p className="text-[13px] text-muted">{l}</p>
            <p className="t-num mt-1 text-2xl font-semibold">{v}</p>
            <p className="text-xs text-faint">{n}</p>
          </div>
        ))}
      </section>

      <Panel title="Days-to-sell anomaly explainer" subtitle="Vehicles at or past their expected days to sell. Open one to see why." className="mb-6" bodyClassName="p-3 sm:p-4">
        {items.length === 0 ? (
          <EmptyState title="No aging vehicles" message="Every vehicle is within its expected days to sell." />
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <AgingRow key={i.vehicleId} item={i} open={open === i.vehicleId} onToggle={() => setOpen((o) => (o === i.vehicleId ? null : i.vehicleId))} onApplied={aging.refetch} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Cross-store benchmarking" subtitle="Last 30 days. Whitefield lot accuracy is live." bodyClassName="p-0">
        {stores.loading ? (
          <div className="p-5"><Spinner /></div>
        ) : stores.error || !stores.data ? (
          <div className="p-5"><ErrorState message={stores.error || 'No data'} onRetry={stores.retry} /></div>
        ) : (
          <div>
            <div className="m-5 flex gap-3 rounded-xl bg-brand/5 p-4 ring-1 ring-brand/20 ring-inset">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-brand dark:text-brand-2" />
              <div>
                <p className="text-sm font-semibold">AI insight</p>
                <p className="mt-1 text-[15px] leading-relaxed">{stores.data.insight}</p>
              </div>
            </div>
            <div className="overflow-x-auto px-5">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2.5 font-medium">Metric</th>
                    {stores.data.stores.map((s) => (
                      <th key={s.code} className="py-2.5 text-right font-medium">
                        {s.label}
                        <span className="block font-normal text-faint">{s.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {metricRows.map((m) => {
                    const vals = stores.data!.stores.map((s) => Number(s[m.key as keyof typeof s]));
                    const best = m.better === 'high' ? Math.max(...vals) : Math.min(...vals);
                    const worst = m.better === 'high' ? Math.min(...vals) : Math.max(...vals);
                    return (
                      <tr key={m.key}>
                        <td className="py-2.5">{m.label}</td>
                        {vals.map((v, i) => (
                          <td key={i} className={cn('t-num py-2.5 text-right', v === best && 'font-semibold text-ok', v === worst && 'font-semibold text-bad')}>
                            {m.fmt(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Operational quality</p>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart
                      data={[
                        { metric: 'Lot accuracy', ...Object.fromEntries(stores.data.stores.map((s) => [s.label, s.lotAccuracy])) },
                        { metric: 'Inspections', ...Object.fromEntries(stores.data.stores.map((s) => [s.label, s.inspectionCompletion])) },
                        { metric: 'Photo sets', ...Object.fromEntries(stores.data.stores.map((s) => [s.label, s.photoCompleteness])) },
                      ]}
                      margin={{ left: -18, right: 8 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="metric" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {stores.data.stores.map((s, i) => (
                        <Bar key={s.code} dataKey={s.label} fill={STORE_COLORS[i]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Average days to sell, 6 months</p>
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={stores.data.trend} margin={{ left: -18, right: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} domain={['dataMin - 3', 'dataMax + 3']} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {stores.data.stores.map((s, i) => (
                        <Line key={s.code} type="monotone" dataKey={s.label} stroke={STORE_COLORS[i]} strokeWidth={2.5} dot={{ r: 3 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
