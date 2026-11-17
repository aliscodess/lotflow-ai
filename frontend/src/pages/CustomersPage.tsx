import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MessageSquare, Phone, Search, Send } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageHeader, PageSkeleton, Panel, Spinner, Textarea } from '../components/ui';
import { ServiceSteps } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { clock, cn, dayClock, STAGES, timeAgo } from '../utils/format';
import type { ServiceStep } from '../types';

const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

function CustomerDetail({ code, onSaved }: { code: string; onSaved: () => void }) {
  const detail = useApi(() => api.customerStatus(code), [code]);
  useLiveRefresh(['customer:updated', 'service:updated'], detail.refetch);
  const { push } = useToast();
  const [stage, setStage] = useState<string | null>(null);
  const [eta, setEta] = useState('');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!detail.data) return;
    setStage(null);
    setEta(toLocalInput(detail.data.status.estimatedCompletion));
    setNote(detail.data.status.advisorNote || '');
  }, [detail.data]);

  if (detail.loading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorState message={detail.error || 'Not found'} onRetry={detail.retry} />;
  const { customer: c, status, task } = detail.data;
  const pendingStage = stage || status.stage;
  const idx = STAGES.findIndex((s) => s.key === pendingStage);
  const previewSteps: ServiceStep[] = STAGES.map((s, i) => ({ key: s.key, label: s.label, status: i < idx || (pendingStage === 'READY' && i === idx) ? 'done' : i === idx ? 'current' : 'pending' }));

  const save = async () => {
    setBusy('save');
    try {
      await api.updateCustomerStatus(c.customerCode, { stage: pendingStage, estimatedCompletion: eta ? new Date(eta).toISOString() : undefined, note, notify });
      push({ title: 'Status updated', message: notify ? `${c.name.split(' ')[0]} was notified on WhatsApp.` : undefined, kind: 'success' });
      onSaved();
      detail.refetch();
    } catch (err) {
      push({ title: 'Could not update status', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const sendUpdate = async () => {
    setBusy('send');
    try {
      await api.notifyCustomer(c.customerCode);
      push({ title: 'Update sent', kind: 'success' });
      detail.refetch();
    } catch (err) {
      push({ title: 'Could not send', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="t-title text-xl">{c.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" /> {c.phone}
            </span>
            <span>{c.email}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StockTag id={c.vehicleId} link />
            <span className="text-sm">{c.vehicleLabel}</span>
            <Badge tone={c.relationship === 'PRE_DELIVERY' ? 'paint' : 'neutral'}>{c.relationship === 'PRE_DELIVERY' ? 'Pre-delivery' : 'Service'}</Badge>
          </div>
        </div>
        <a href={`/track/${c.trackingCode}`} target="_blank" rel="noreferrer">
          <Button variant="secondary" icon={<ExternalLink className="size-4" />}>
            Open customer view
          </Button>
        </a>
      </div>

      {task && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm ring-1 ring-line ring-inset">
          Linked to <span className="font-medium">{task.taskId}</span>: {task.issue}. {task.technicianName ? `${task.technicianName}, ` : ''}
          {task.scheduledTime ? `starts ${dayClock(task.scheduledTime)}` : 'not yet scheduled'}.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-3 text-sm font-semibold">Service status</p>
          <ServiceSteps steps={stage ? previewSteps : status.steps} onSelect={setStage} />
          <p className="text-xs text-faint">Select a step to move the customer to it. Status also updates automatically from the repair order.</p>
        </div>
        <div className="space-y-4">
          <Field label="Estimated completion">
            <Input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
          </Field>
          <Field label="Note to customer">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional message shown on the tracking page" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
            Notify the customer on WhatsApp
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy === 'save'}>
              Update status
            </Button>
            <Button variant="secondary" icon={<Send className="size-4" />} onClick={sendUpdate} loading={busy === 'send'}>
              Resend current status
            </Button>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Messages sent</p>
        <ul className="space-y-2">
          {[...c.notifications].reverse().map((n, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-line p-3">
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-faint" />
              <div className="min-w-0">
                <p className="text-sm">{n.message}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {n.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} · {clock(n.at)} · {timeAgo(n.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const list = useApi(() => api.customers(), []);
  useLiveRefresh(['customer:updated', 'system:reset'], list.refetch);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const items = useMemo(() => (list.data?.items || []).filter((c) => `${c.name} ${c.vehicleId} ${c.vehicleLabel}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);

  useEffect(() => {
    if (!selected && items.length) setSelected(items.find((c) => c.vehicleId === '2847')?.customerCode || items[0].customerCode);
  }, [items, selected]);

  if (list.loading) return <PageSkeleton />;
  if (list.error) return <ErrorState message={list.error} onRetry={list.retry} />;

  return (
    <div>
      <PageHeader title="Customers" description="Proactive service status. Customers see the same progress on their phone, updated automatically as the job moves." />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or stock number" className="pl-9" />
          </div>
          {items.length === 0 ? (
            <EmptyState title="No customers found" />
          ) : (
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.customerCode}>
                  <button type="button" onClick={() => setSelected(c.customerCode)} className={cn('w-full rounded-xl border p-3 text-left transition-colors', selected === c.customerCode ? 'border-brand bg-brand/5' : 'border-line bg-surface hover:bg-surface-2')}>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-medium">{c.name}</span>
                      <StockTag id={c.vehicleId} size="sm" />
                    </div>
                    <p className="mt-1 text-sm text-muted">{c.view.stageLabel}</p>
                    <p className="text-xs text-faint">Est. completion {dayClock(c.view.estimatedCompletion)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Panel>{selected ? <CustomerDetail key={selected} code={selected} onSaved={list.refetch} /> : <EmptyState title="Select a customer" />}</Panel>
      </div>
    </div>
  );
}
