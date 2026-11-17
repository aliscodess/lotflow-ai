import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, ClipboardCheck, Clock, Package, Play, Plus, Search, Sparkles, Truck, UserRound, Wrench, Zap } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Badge, Button, EmptyState, ErrorState, Input, Meter, PageHeader, PageSkeleton, Panel, Segmented, Select, Spinner } from '../components/ui';
import { PriorityBadge, TaskBadge } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { PartsResolver, ResolvedNotice } from '../components/PartsResolver';
import { bayName, clock, cn, dayClock, timeAgo } from '../utils/format';
import type { DispatchOp, ServiceBoard, ServiceTask } from '../types';

type Tab = 'bays' | 'orders' | 'inspections' | 'parts';

const STATUS_FILL: Record<string, string> = {
  IN_PROGRESS: 'bg-svc text-white',
  SCHEDULED: 'bg-brand/85 text-white',
  WAITING_PARTS: 'bg-warn text-asphalt',
  COMPLETED: 'bg-surface-2 text-muted ring-1 ring-line ring-inset',
};

/* ---------------- Bays & schedule ---------------- */

function BayCards({ board }: { board: ServiceBoard }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {board.bays.map((b) => (
        <div key={b.code} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="t-title text-lg">{b.name}</p>
            <Badge tone={b.status === 'OCCUPIED' ? 'svc' : b.status === 'BLOCKED' ? 'warn' : b.status === 'RESERVED' ? 'brand' : 'ok'} dot>
              {b.status === 'OCCUPIED' ? 'In progress' : b.status === 'BLOCKED' ? 'Waiting' : b.status === 'RESERVED' ? 'Starting soon' : 'Available'}
            </Badge>
          </div>
          <p className="text-xs text-faint">{b.type === 'GENERAL' ? 'General repair · lift' : b.type === 'QUICK' ? 'Quick service · tyres' : b.type === 'EV' ? 'EV & electrical' : 'Body & paint'}</p>
          {b.current ? (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <StockTag id={b.current.vehicleId} size="md" link />
                {b.current.overrun ? <Badge tone="bad">+{b.current.overrun} min</Badge> : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{b.current.issue}</p>
              <p className="mt-1 text-sm text-muted">Technician: {b.current.technicianName}</p>
              {b.current.status === 'IN_PROGRESS' && (
                <div className="mt-3">
                  <Meter value={b.current.progress} color="var(--color-svc)" />
                  <p className="mt-1 text-xs text-faint">Ends {clock(b.current.end)}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-2xl font-semibold text-ok">Available</p>
          )}
          {b.next && (
            <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">
              Next: <span className="font-medium text-ink">#{b.next.vehicleId}</span> at {clock(b.next.start)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Gantt({ board }: { board: ServiceBoard }) {
  const start = new Date(board.window.start).getTime();
  const end = new Date(board.window.end).getTime();
  const span = end - start;
  const pct = (t: string | number) => Math.max(0, Math.min(100, ((new Date(t).getTime() - start) / span) * 100));
  const hours = Array.from({ length: Math.round(span / 3600000) + 1 }, (_, i) => start + i * 3600000);
  const now = pct(board.now);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="min-w-[760px]">
        <div className="relative ml-16 h-6 text-[11px] text-faint">
          {hours.filter((h) => pct(h) < 97).map((h) => (
            <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(h)}%` }}>
              {new Date(h).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true }).toUpperCase()}
            </span>
          ))}
        </div>
        {board.bays.map((b) => (
          <div key={b.code} className="flex items-center border-t border-line">
            <span className="w-16 shrink-0 py-3 text-sm font-medium">{b.name}</span>
            <div className="relative h-11 flex-1">
              {hours.map((h) => (
                <span key={h} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${pct(h)}%` }} />
              ))}
              {board.timeline
                .filter((t) => t.bay === b.code)
                .map((t) => (
                  <div
                    key={t.taskId}
                    title={`${t.taskId} · #${t.vehicleId} · ${t.issue} · ${clock(t.start)}–${clock(t.end)} · ${t.technicianName || ''}`}
                    className={cn('absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md px-1.5 text-[11px] font-semibold', STATUS_FILL[t.status] || 'bg-brand text-white', t.priority === 'URGENT' && 'ring-2 ring-bad')}
                    style={{ left: `${pct(t.start)}%`, width: `${Math.max(1.5, pct(t.end) - pct(t.start))}%` }}
                  >
                    <span className="t-condensed truncate">#{t.vehicleId}</span>
                  </div>
                ))}
              <span className="absolute inset-y-0 w-0.5 bg-bad" style={{ left: `${now}%` }} aria-label="Now" />
            </div>
          </div>
        ))}
        <div className="mt-3 ml-16 flex flex-wrap gap-4 text-xs text-muted">
          {[
            ['bg-svc', 'In progress'],
            ['bg-brand/85', 'Scheduled'],
            ['bg-warn', 'Waiting on parts'],
            ['bg-surface-2 ring-1 ring-line', 'Completed'],
            ['bg-bad', 'Now'],
          ].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-sm', c)} /> {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const OP_ICON: Record<DispatchOp['kind'], typeof Zap> = { PRIORITIZE: Zap, REASSIGN_TECH: UserRound, RESCHEDULE: Clock, MOVE_BAY: ArrowRight, SCHEDULE: CalendarClock };

function DispatchPanel({ onApplied }: { onApplied: () => void }) {
  const rec = useApi(() => api.recommendation(), []);
  useLiveRefresh(['service:updated', 'system:reset'], rec.refetch);
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applyDispatch();
      setApplied(`${r.appliedCount} change${r.appliedCount === 1 ? '' : 's'} applied. Expected idle time ${r.idleBefore} min → ${r.idleAfter} min.`);
      push({ title: 'Recommendation applied', message: `${r.appliedCount} schedule changes`, kind: 'success' });
      onApplied();
      rec.refetch();
    } catch (err) {
      push({ title: 'Could not apply', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand dark:text-brand-2" /> AI scheduling recommendation
        </span>
      }
      subtitle="Rule-based dispatch: technician availability, parts arrival, bay capacity and urgency"
      actions={rec.data && rec.data.ops.length > 0 && <Button onClick={apply} loading={busy}>Apply recommendation</Button>}
    >
      {rec.loading ? (
        <Spinner />
      ) : rec.error ? (
        <ErrorState message={rec.error} onRetry={rec.retry} />
      ) : rec.data && rec.data.ops.length ? (
        <>
          <ul className="divide-y divide-line">
            {rec.data.ops.map((op) => {
              const Icon = OP_ICON[op.kind];
              return (
                <li key={op.taskId} className="flex gap-3 py-3 first:pt-0">
                  <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', op.kind === 'PRIORITIZE' ? 'bg-bad/12 text-bad' : 'bg-brand/10 text-brand dark:text-brand-2')}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{op.title}</p>
                    <p className="text-sm text-muted">{op.reason}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                      {op.changes.time && <span className="rounded-md bg-surface-2 px-2 py-0.5 ring-1 ring-line ring-inset">{op.changes.time.from} → {op.changes.time.to}</span>}
                      {op.changes.bay && <span className="rounded-md bg-surface-2 px-2 py-0.5 ring-1 ring-line ring-inset">{op.changes.bay.from} → {op.changes.bay.to}</span>}
                      {op.changes.technician && <span className="rounded-md bg-surface-2 px-2 py-0.5 ring-1 ring-line ring-inset">{op.changes.technician.from} → {op.changes.technician.to}</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line ring-inset">
            <div>
              <p className="text-xs text-faint">Expected bay idle time</p>
              <p className="t-num text-lg font-semibold">
                {rec.data.idleBefore} min <ArrowRight className="inline size-4 text-faint" /> <span className="text-ok">{rec.data.idleAfter} min</span>
              </p>
            </div>
            <p className="text-sm text-muted">{rec.data.savedMinutes} bay-minutes recovered today</p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">{applied || rec.data?.summary || 'The schedule is already optimal.'}</p>
      )}
      {applied && rec.data && rec.data.ops.length > 0 && <p className="mt-3 text-sm text-ok">{applied}</p>}
    </Panel>
  );
}

function Technicians({ board }: { board: ServiceBoard }) {
  return (
    <ul className="divide-y divide-line">
      {board.technicians.map((t) => (
        <li key={t._id} className="flex items-center gap-3 py-2.5">
          <span className={cn('size-2 shrink-0 rounded-full', t.status === 'OFF' ? 'bg-hold' : t.status === 'BUSY' ? 'bg-svc' : 'bg-ok')} />
          <div className="w-36 min-w-0 shrink-0">
            <p className="truncate text-sm font-medium">{t.name}</p>
            <p className="truncate text-xs text-faint">{t.status === 'OFF' ? t.statusNote || 'Off today' : `${t.level} · ${t.skills.slice(0, 2).join(', ').toLowerCase()}`}</p>
          </div>
          <div className="min-w-0 flex-1">
            <Meter value={t.assignedMinutes + t.completedMinutes} max={t.capacityMinutes} color={t.status === 'OFF' ? 'var(--color-hold)' : t.assignedMinutes + t.completedMinutes > 420 ? 'var(--color-warn)' : 'var(--color-brand)'} />
          </div>
          <span className="t-num w-16 shrink-0 text-right text-xs text-muted">{Math.round((t.assignedMinutes + t.completedMinutes) / 6) / 10} h</span>
          {t.currentTask && <StockTag id={t.currentTask.vehicleId} size="sm" />}
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Repair orders ---------------- */

function TaskDetail({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const detail = useApi(() => api.task(taskId), [taskId]);
  const parts = useApi(() => api.parts(), []);
  useLiveRefresh(['service:updated', 'parts:updated'], detail.refetch);
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [partNumber, setPartNumber] = useState('');
  const [resolvedMessage, setResolvedMessage] = useState<string | null>(null);

  if (detail.loading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorState message={detail.error || 'Not found'} onRetry={detail.retry} />;
  const { task, resolutions } = detail.data;

  const run = async (key: string, fn: () => Promise<{ message?: string }>) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r?.message) push({ title: r.message, kind: 'success' });
      detail.refetch();
      onChanged();
    } catch (err) {
      push({ title: 'Action failed', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const addPart = (pn: string) =>
    run(`part-${pn}`, async () => {
      const r = await api.addPart(task.taskId, pn);
      return { message: r.reserved ? `${r.task.requiredParts.find((l) => l.partNumber === pn)?.name} reserved from local stock` : r.duplicate ? 'Part already on this job' : 'Shortage detected. See the AI recommendation below.' };
    });

  const suggestions = (task.suggestedParts || []).filter((s) => !task.requiredParts.some((l) => l.partNumber === s.partNumber));
  const closed = ['COMPLETED', 'CANCELLED'].includes(task.status);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-title">{task.taskId}</span>
          <StockTag id={task.vehicleId} link />
          <PriorityBadge priority={task.priority} />
          <TaskBadge status={task.status} />
        </div>
        <p className="mt-2 font-medium">{task.issue}</p>
        <p className="text-sm text-muted">{task.vehicleLabel}</p>
        {task.description && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted ring-1 ring-line ring-inset">“{task.description}”</p>}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-faint">Bay</dt>
          <dd className="font-medium">{bayName(task.bay)}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Technician</dt>
          <dd className="font-medium">{task.technicianName || 'Unassigned'}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Scheduled</dt>
          <dd className="font-medium">{task.scheduledTime ? `${dayClock(task.scheduledTime)}` : 'Not yet'}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Est. completion</dt>
          <dd className="font-medium">{task.scheduledEnd ? clock(task.scheduledEnd) : '—'} <span className="text-faint">({task.estimatedDuration} min)</span></dd>
        </div>
      </dl>

      {!closed && (
        <div className="flex flex-wrap gap-2">
          {['SCHEDULED', 'WAITING_PARTS', 'UNSCHEDULED'].includes(task.status) && (
            <Button size="sm" icon={<Play className="size-4" />} loading={busy === 'start'} onClick={() => run('start', () => api.updateTask(task.taskId, { status: 'IN_PROGRESS' }))}>
              Start job
            </Button>
          )}
          {task.status === 'IN_PROGRESS' && (
            <Button size="sm" loading={busy === 'qc'} onClick={() => run('qc', () => api.updateTask(task.taskId, { status: 'QUALITY_CHECK' }))}>
              Move to quality check
            </Button>
          )}
          {task.status === 'QUALITY_CHECK' && (
            <Button size="sm" loading={busy === 'done'} onClick={() => run('done', () => api.updateTask(task.taskId, { status: 'COMPLETED' }))}>
              Mark completed
            </Button>
          )}
          {task.status !== 'IN_PROGRESS' && task.status !== 'QUALITY_CHECK' && (
            <Button size="sm" variant="secondary" icon={<CalendarClock className="size-4" />} loading={busy === 'resched'} onClick={() => run('resched', () => api.updateTask(task.taskId, { reschedule: true }))}>
              {task.scheduledTime ? 'Find earlier slot' : 'Schedule now'}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<UserRound className="size-4" />} loading={busy === 'reassign'} onClick={() => run('reassign', () => api.updateTask(task.taskId, { reassign: true }))}>
            Reassign technician
          </Button>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold">Required parts</p>
        {task.requiredParts.length ? (
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {task.requiredParts.map((l) => (
              <li key={l.partNumber} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <Package className="size-4 text-faint" />
                <span className="min-w-0 flex-1">
                  {l.name} <span className="text-faint">× {l.qty}</span>
                </span>
                <Badge tone={l.status === 'SHORTAGE' ? 'bad' : ['TRANSFER_REQUESTED', 'IN_TRANSIT', 'ORDERED'].includes(l.status) ? 'warn' : 'ok'}>
                  {l.status === 'TRANSFER_REQUESTED' ? `Transfer requested${l.eta ? `, ETA ${clock(l.eta)}` : ''}` : l.status.charAt(0) + l.status.slice(1).toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">No parts on this job yet.</p>
        )}

        {!closed && (
          <div className="mt-3">
            {suggestions.length > 0 && (
              <>
                <p className="text-xs text-faint">Common parts for this model</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.partNumber}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => addPart(s.partNumber)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-[13px] hover:border-brand hover:text-brand disabled:opacity-50 dark:hover:text-brand-2"
                    >
                      {busy === `part-${s.partNumber}` ? <Spinner className="size-3.5" /> : <Plus className="size-3.5" />}
                      {s.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mt-2 flex gap-2">
              <Select value={partNumber} onChange={(e) => setPartNumber(e.target.value)} aria-label="Add a part" className="flex-1">
                <option value="">Add another part…</option>
                {parts.data?.items.map((p) => (
                  <option key={p.partNumber} value={p.partNumber}>
                    {p.name} ({p.partNumber})
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={!partNumber || busy !== null}
                onClick={() => {
                  addPart(partNumber);
                  setPartNumber('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {resolvedMessage && <ResolvedNotice message={resolvedMessage} />}
      {resolutions.map((r) => (
        <PartsResolver
          key={r.part.partNumber}
          resolution={r}
          taskId={task.taskId}
          onResolved={(message) => {
            setResolvedMessage(message);
            detail.refetch();
            onChanged();
          }}
        />
      ))}

      <div>
        <p className="text-sm font-semibold">History</p>
        <ol className="mt-2 space-y-2 border-l border-line pl-4">
          {[...task.history].reverse().map((h, i) => (
            <li key={i} className="text-sm">
              <p>{h.message}</p>
              <p className="text-xs text-faint">
                {timeAgo(h.at)}
                {h.actor ? ` · ${h.actor}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function RepairOrders({ selected, setSelected, onChanged }: { selected: string | null; setSelected: (id: string) => void; onChanged: () => void }) {
  const tasks = useApi(() => api.tasks(), []);
  useLiveRefresh(['service:updated', 'system:reset'], tasks.refetch);
  const [filter, setFilter] = useState<'OPEN' | 'WAITING_PARTS' | 'COMPLETED'>('OPEN');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    let items = tasks.data?.items || [];
    if (filter === 'OPEN') items = items.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));
    else items = items.filter((t) => t.status === filter);
    if (q) items = items.filter((t) => `${t.taskId} ${t.vehicleId} ${t.issue}`.toLowerCase().includes(q.toLowerCase()));
    const rank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return [...items].sort((a, b) => Number(b.taskId === selected) - Number(a.taskId === selected) || (a.status === 'WAITING_PARTS' ? -1 : 0) - (b.status === 'WAITING_PARTS' ? -1 : 0) || rank[a.priority] - rank[b.priority]);
  }, [tasks.data, filter, q, selected]);

  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].taskId);
  }, [selected, list, setSelected]);

  if (tasks.loading) return <PageSkeleton />;
  if (tasks.error) return <ErrorState message={tasks.error} onRetry={tasks.retry} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'OPEN', label: 'Open' }, { value: 'WAITING_PARTS', label: 'Waiting on parts' }, { value: 'COMPLETED', label: 'Completed' }]} />
          <div className="relative w-full">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RO, stock no. or issue" className="pl-9" />
          </div>
        </div>
        <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {list.length === 0 && <EmptyState title="Nothing here" message="Repair orders matching this filter will appear here." />}
          {list.map((t: ServiceTask) => (
            <li key={t.taskId}>
              <button type="button" onClick={() => setSelected(t.taskId)} className={cn('w-full rounded-xl border p-3 text-left transition-colors', selected === t.taskId ? 'border-brand bg-brand/5' : 'border-line bg-surface hover:bg-surface-2')}>
                <div className="flex items-center gap-2">
                  <StockTag id={t.vehicleId} size="sm" />
                  <span className="text-xs text-faint">{t.taskId}</span>
                  <span className="flex-1" />
                  <TaskBadge status={t.status} />
                </div>
                <p className="mt-1.5 line-clamp-1 text-sm font-medium">{t.issue}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t.bay ? bayName(t.bay) : 'No bay'} · {t.technicianName || 'Unassigned'} · {t.scheduledTime ? dayClock(t.scheduledTime) : 'unscheduled'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 rounded-2xl border border-line bg-surface p-5">{selected ? <TaskDetail key={selected} taskId={selected} onChanged={() => { tasks.refetch(); onChanged(); }} /> : <EmptyState title="Select a repair order" />}</div>
    </div>
  );
}

/* ---------------- Inspections ---------------- */

function Inspections({ onConverted }: { onConverted: (taskId: string) => void }) {
  const list = useApi(() => api.inspections('OPEN'), []);
  useLiveRefresh(['inspection:new', 'service:updated', 'alert:updated', 'system:reset'], list.refetch);
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const convert = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.convertInspection(id);
      push({ title: 'Repair order created', message: r.message, kind: 'success' });
      onConverted(r.task.taskId);
    } catch (err) {
      push({ title: 'Could not create repair order', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (list.loading) return <PageSkeleton />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.retry} />;
  if (!list.data?.items.length) return <div className="rounded-2xl border border-line bg-surface"><EmptyState icon={<ClipboardCheck className="size-8" />} title="No open inspections" message="Inspections reported by voice from the lot land here, ready to turn into repair orders." /></div>;

  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {list.data.items.map((i) => (
        <li key={i.inspectionId} className="animate-rise rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StockTag id={i.vehicleId} link />
            <span className="text-sm font-medium">{i.vehicleLabel}</span>
            <span className="flex-1" />
            <PriorityBadge priority={i.priority} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {i.issues.map((x) => (
              <li key={x.area + x.description} className="flex items-center gap-2 text-sm">
                <span className={cn('size-2 rounded-full', x.severity === 'high' ? 'bg-bad' : x.severity === 'medium' ? 'bg-warn' : 'bg-hold')} />
                <span>{x.area.charAt(0).toUpperCase() + x.area.slice(1)}</span>
                <ArrowRight className="size-3.5 text-faint" />
                <span>{x.description}</span>
              </li>
            ))}
          </ul>
          {i.transcript && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted ring-1 ring-line ring-inset">“{i.transcript}”</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-xs text-faint">
              {i.inspectionId} · {i.source === 'VOICE' ? 'voice report' : 'manual'} by {i.reportedBy?.name} · {timeAgo(i.createdAt)}
            </p>
            <Button size="sm" icon={<Wrench className="size-4" />} loading={busy === i.inspectionId} onClick={() => convert(i.inspectionId)}>
              Create repair order
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Parts ---------------- */

function PartsTab() {
  const [q, setQ] = useState('');
  const [shortOnly, setShortOnly] = useState(false);
  const parts = useApi(() => api.parts({ q: q || undefined, shortage: shortOnly || undefined }), [q, shortOnly]);
  const transfers = useApi(() => api.transfers(), []);
  useLiveRefresh(['parts:updated', 'service:updated', 'system:reset'], transfers.refetch);
  useLiveRefresh(['parts:updated', 'system:reset'], parts.refetch);
  const { push } = useToast();

  const receive = async (id: string) => {
    try {
      await api.receiveTransfer(id);
      push({ title: `${id} received`, kind: 'success' });
      transfers.refetch();
      parts.refetch();
    } catch (err) {
      push({ title: 'Could not update transfer', message: errorMessage(err), kind: 'error' });
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel
        title="Parts inventory"
        subtitle="Available units (on hand minus reserved) across the group"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts or models" className="h-9 w-56 pl-9" />
            </div>
            <Button size="sm" variant={shortOnly ? 'primary' : 'secondary'} onClick={() => setShortOnly((s) => !s)}>
              Out of stock here
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        {parts.loading ? (
          <div className="p-5"><Spinner /></div>
        ) : parts.error ? (
          <div className="p-5"><ErrorState message={parts.error} onRetry={parts.retry} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Part</th>
                  {parts.data?.stores.map((s) => (
                    <th key={s.code} className="px-3 py-2.5 text-right font-medium">
                      {s.name}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium">Lead time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parts.data?.items.map((p) => (
                  <tr key={p.partNumber}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-faint">
                        {p.partNumber} · {p.compatibleModels.includes('*') ? 'Universal' : p.compatibleModels.join(', ')}
                      </p>
                    </td>
                    {parts.data?.stores.map((s) => {
                      const inv = p.inventoryByStore.find((i) => i.storeCode === s.code);
                      const avail = inv ? inv.quantity - inv.reserved : 0;
                      return (
                        <td key={s.code} className={cn('t-num px-3 py-2.5 text-right', avail <= 0 ? 'text-bad' : avail <= (inv?.reorderLevel || 0) ? 'text-warn' : '')}>
                          {avail}
                        </td>
                      );
                    })}
                    <td className="t-num px-4 py-2.5 text-right text-muted">{p.leadTimeDays} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Transfers" subtitle="Inter-store part movements" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {transfers.data?.items.map((t) => (
            <li key={t.transferId} className="px-5 py-3">
              <div className="flex items-center gap-2">
                <Truck className="size-4 text-faint" />
                <span className="text-sm font-medium">{t.transferId}</span>
                <span className="flex-1" />
                <Badge tone={t.status === 'RECEIVED' ? 'ok' : 'warn'}>{t.status === 'RECEIVED' ? 'Received' : 'Requested'}</Badge>
              </div>
              <p className="mt-1 text-sm">
                {t.partName} × {t.qty}
              </p>
              <p className="text-xs text-muted">
                {t.fromStore} → {t.toStore} · {t.distanceKm} km · ETA {dayClock(t.eta)}
                {t.vehicleId ? ` · for #${t.vehicleId}` : ''}
              </p>
              {t.status !== 'RECEIVED' && (
                <button type="button" onClick={() => receive(t.transferId)} className="mt-1.5 text-xs font-medium text-brand hover:underline dark:text-brand-2">
                  Mark received
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function ServicePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'bays';
  const [selectedTask, setSelectedTask] = useState<string | null>(params.get('task'));
  const board = useApi(() => api.board(), []);
  const inspections = useApi(() => api.inspections('OPEN'), []);
  useLiveRefresh(['service:updated', 'system:reset'], board.refetch);
  useLiveRefresh(['inspection:new', 'service:updated', 'system:reset'], inspections.refetch);

  const setTab = (t: Tab) => setParams(t === 'bays' ? {} : { tab: t });
  const openInspections = inspections.data?.items.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Service"
        description="Bays, technicians and parts in one place. LotFlow schedules work around availability and tells customers automatically."
        actions={
          board.data && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="svc">{board.data.stats.inProgress} in progress</Badge>
              <Badge tone="warn">{board.data.stats.waitingParts} waiting on parts</Badge>
              <Badge tone="ok">{board.data.stats.completedToday} completed today</Badge>
            </div>
          )
        }
      />
      <Segmented<Tab>
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'bays', label: 'Bays & schedule' },
          { value: 'orders', label: 'Repair orders' },
          { value: 'inspections', label: 'Inspections', count: openInspections },
          { value: 'parts', label: 'Parts' },
        ]}
      />

      {tab === 'bays' &&
        (board.loading ? (
          <PageSkeleton />
        ) : board.error || !board.data ? (
          <ErrorState message={board.error || 'No data'} onRetry={board.retry} />
        ) : (
          <div className="space-y-6">
            <BayCards board={board.data} />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              <DispatchPanel onApplied={board.refetch} />
              <Panel title="Technician workload" subtitle="Hours booked today out of a 9-hour shift">
                <Technicians board={board.data} />
              </Panel>
            </div>
            <Panel title="Today's appointments" subtitle="Bay schedule, two hours back and eight ahead">
              <Gantt board={board.data} />
            </Panel>
          </div>
        ))}

      {tab === 'orders' && <RepairOrders selected={selectedTask} setSelected={setSelectedTask} onChanged={board.refetch} />}
      {tab === 'inspections' && (
        <Inspections
          onConverted={(taskId) => {
            setSelectedTask(taskId);
            setParams({ tab: 'orders', task: taskId });
            inspections.refetch();
          }}
        />
      )}
      {tab === 'parts' && <PartsTab />}
    </div>
  );
}
