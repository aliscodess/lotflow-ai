import { useMemo, useState } from 'react';
import { CircleCheck, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, Panel, Segmented } from '../components/ui';
import { AlertCard } from '../components/AlertCard';
import { StockTag } from '../components/StockTag';
import { timeAgo } from '../utils/format';

type PFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM';

export default function ActionCenterPage() {
  const actions = useApi(() => api.actions(), []);
  useLiveRefresh(['alert:new', 'alert:updated', 'system:reset'], actions.refetch);
  const [filter, setFilter] = useState<PFilter>('ALL');

  const open = useMemo(() => (actions.data?.open || []).filter((a) => filter === 'ALL' || a.priority === filter), [actions.data, filter]);

  if (actions.loading) return <PageSkeleton />;
  if (actions.error || !actions.data) return <ErrorState message={actions.error || 'No data'} onRetry={actions.retry} />;
  const { counts, applied } = actions.data;
  const count = (p: PFilter) => actions.data!.open.filter((a) => p === 'ALL' || a.priority === p).length;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="t-num">{counts.open}</span> AI actions recommended
          </span>
        }
        description="Each recommendation comes with the reason, the action LotFlow will take and the expected impact. Apply runs the workflow end to end."
      />
      <Segmented<PFilter>
        className="mb-5"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'ALL', label: 'All', count: count('ALL') },
          { value: 'CRITICAL', label: 'Critical', count: count('CRITICAL') },
          { value: 'HIGH', label: 'High', count: count('HIGH') },
          { value: 'MEDIUM', label: 'Medium', count: count('MEDIUM') },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          {open.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface">
              <EmptyState icon={<Sparkles className="size-8" />} title="You are all caught up" message="New recommendations appear here as LotFlow detects inspections, shortages, delays and aging stock." />
            </div>
          ) : (
            open.map((a) => <AlertCard key={a._id} alert={a} detailed onApplied={() => setTimeout(actions.refetch, 1200)} />)
          )}
        </div>
        <Panel title="Applied today" subtitle={`${counts.appliedToday} actions completed`} bodyClassName="p-0">
          {applied.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Applied actions and their outcomes are logged here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {applied.map((a) => (
                <li key={a._id} className="px-5 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{a.resolution?.note}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        {a.vehicleId && <StockTag id={a.vehicleId} size="sm" link />}
                        <span className="text-xs text-faint">
                          {a.resolution?.by} · {timeAgo(a.resolution?.at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
