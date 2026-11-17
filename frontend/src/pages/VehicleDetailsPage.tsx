import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ImagePlus, Lightbulb, MapPin, Mic } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, EmptyState, ErrorState, KeyValue, PageSkeleton, Panel } from '../components/ui';
import { HealthBreakdown, HealthRing, PhotoPlaceholder, PriorityBadge, StatusBadge, TaskBadge } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { Timeline } from '../components/Timeline';
import { bayName, cn, dayClock, km, lakh, shortDate, timeAgo } from '../utils/format';
import type { ConditionStatus } from '../types';

const CONDITION_ORDER = ['exterior', 'interior', 'tires', 'battery', 'mechanical', 'fuel'];
const CONDITION_LABEL: Record<string, string> = { exterior: 'Exterior', interior: 'Interior', tires: 'Tyres', fuel: 'Fuel', battery: 'Battery', mechanical: 'Mechanical' };
const COND_TONE: Record<ConditionStatus, 'ok' | 'warn' | 'bad'> = { GOOD: 'ok', FAIR: 'warn', POOR: 'bad' };
const SECTIONS = ['Overview', 'Condition', 'Location', 'Photos', 'Inspection history', 'Service history', 'AI insights', 'Activity timeline'];
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

export default function VehicleDetailsPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const data = useApi(() => api.vehicle(id), [id]);
  useLiveRefresh(['vehicle:updated', 'activity:new', 'service:updated', 'system:reset'], data.refetch);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (data.loading) return <PageSkeleton />;
  if (data.error || !data.data) return <ErrorState message={data.error || 'Vehicle not found'} onRetry={data.retry} />;
  const { vehicle: v, inspections, tasks, activity, customer, aging } = data.data;
  const isInventory = v.ownership === 'INVENTORY';
  const agingFlag = isInventory && v.daysInInventory > v.expectedDaysToSell;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await api.uploadVehiclePhotos(v.vehicleId, Array.from(files));
      push({ title: 'Photos added', kind: 'success' });
      data.refetch();
    } catch (err) {
      push({ title: 'Upload failed', message: errorMessage(err), kind: 'error' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Link to="/vehicles" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Vehicles
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <StockTag id={v.vehicleId} size="xl" />
            <StatusBadge status={v.status} />
            {agingFlag && <Badge tone="warn">Aging</Badge>}
            {v.flags?.merchandisingPlan && <Badge tone="brand">Merchandising plan active</Badge>}
          </div>
          <h1 className="t-display mt-3 text-2xl sm:text-3xl">Vehicle #{v.vehicleId}</h1>
          <p className="mt-1 text-muted">
            {v.year} {v.make} {v.model} {v.variant} · {v.type} · {v.color}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(user?.role === 'LOT_ASSOCIATE' || user?.role === 'MANAGER') && (
            <Link to="/voice">
              <Button variant="secondary" icon={<Mic className="size-4" />}>
                Report by voice
              </Button>
            </Link>
          )}
          <Link to="/lot">
            <Button variant="secondary" icon={<MapPin className="size-4" />}>
              {v.locationLabel}
            </Button>
          </Link>
        </div>
      </header>

      <nav className="scrollbar-thin -mx-1 mb-6 flex gap-1 overflow-x-auto px-1" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s} href={`#${slug(s)}`} className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-muted ring-1 ring-line ring-inset hover:bg-surface hover:text-ink">
            {s}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel id="overview" title="Overview">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <KeyValue label="VIN">
                <span className="font-mono text-[13px]">{v.vin}</span>
              </KeyValue>
              <KeyValue label="Fuel / transmission">
                <span className="capitalize">{v.fuelType.toLowerCase()}</span> · {v.transmission}
              </KeyValue>
              <KeyValue label="Odometer">{km(v.odometerKm)}</KeyValue>
              <KeyValue label="List price">{isInventory ? lakh(v.listPriceINR) : 'Customer vehicle'}</KeyValue>
              {isInventory && (
                <>
                  <KeyValue label="Days in inventory">
                    <span className={cn('t-num', agingFlag && 'text-warn')}>{v.daysInInventory}</span> <span className="text-faint">/ {v.expectedDaysToSell} expected</span>
                  </KeyValue>
                  <KeyValue label="Listing completeness">{v.listingCompleteness}%</KeyValue>
                  <KeyValue label="Online views (7 days)">{v.listing?.viewsLast7d ?? '—'}</KeyValue>
                  <KeyValue label="Leads (7 days)">{v.listing?.leadsLast7d ?? '—'}</KeyValue>
                </>
              )}
            </dl>
            {customer && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line ring-inset">
                <p className="text-sm">
                  <span className="font-medium">{customer.name}</span>
                  <span className="text-muted"> · {customer.relationship === 'PRE_DELIVERY' ? 'Reserved, awaiting delivery' : 'Service customer'} · {customer.phone}</span>
                </p>
                <a href={`/track/${customer.trackingCode}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline dark:text-brand-2">
                  Customer view <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
          </Panel>

          <Panel id="condition" title="Condition" subtitle={`Updated ${timeAgo(v.updatedAt)}`}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {CONDITION_ORDER.map((key) => {
                const c = v.condition?.[key];
                if (!c) return null;
                return (
                  <li key={key} className="flex items-start gap-3 rounded-xl border border-line p-3">
                    <Badge tone={COND_TONE[c.status]}>{c.status === 'GOOD' ? 'Good' : c.status === 'FAIR' ? 'Fair' : 'Poor'}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{CONDITION_LABEL[key]}</p>
                      <p className="text-sm text-muted">
                        {c.notes || (c.status === 'GOOD' ? 'No issues reported' : '—')}
                        {c.level !== undefined && c.level !== null && (key === 'fuel' || v.fuelType === 'EV') ? ` · ${c.level}${key === 'battery' && v.fuelType !== 'EV' ? ' V' : '%'}` : ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel id="location" title="Location" subtitle={v.location.updatedBy ? `Recorded by ${v.location.updatedBy} ${timeAgo(v.location.updatedAt)}` : undefined}>
            {v.location.zone === 'SERVICE' ? (
              <p className="text-sm">In the service area.</p>
            ) : v.location.row ? (
              <div>
                <div className="asphalt overflow-x-auto rounded-xl p-3">
                  <div className="flex min-w-[520px] items-center gap-3">
                    <span className="t-display w-8 text-xl text-chalk">{v.location.row}</span>
                    <div className="grid flex-1 grid-cols-12">
                      {Array.from({ length: 12 }, (_, i) => (
                        <div key={i} className="flex h-12 items-center justify-center border-l-2 border-chalk/60 last:border-r-2">
                          {i + 1 === v.location.position ? <StockTag id={v.vehicleId} size="sm" /> : <span className="t-condensed text-xs text-chalk/30">{i + 1}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-sm text-muted">
                  Row {v.location.row}, position {v.location.position}
                  {v.location.zone === 'DISPLAY' ? ' (front display)' : ''}. Last verified {timeAgo(v.lastSeenAt)}.
                </p>
              </div>
            ) : (
              <p className="text-sm text-warn">No position recorded. A location check is needed.</p>
            )}
          </Panel>

          <Panel
            id="photos"
            title="Photos"
            subtitle={`${v.photos.length} photos`}
            actions={
              <>
                <Button size="sm" variant="secondary" loading={uploading} icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
                  Add photos
                </Button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {[...v.photos].reverse().slice(0, 15).map((p, i) =>
                p.url ? (
                  <a key={p._id || i} href={p.url} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-xl ring-1 ring-line">
                    <img src={p.url} alt={p.label} className="size-full object-cover" loading="lazy" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 px-2 py-1 text-[11px] text-white">{p.label}</span>
                  </a>
                ) : (
                  <PhotoPlaceholder key={p._id || i} label={p.label} type={v.type} />
                ),
              )}
            </div>
          </Panel>

          <Panel id="inspection-history" title="Inspection history" bodyClassName="p-0">
            {inspections.length ? (
              <ul className="divide-y divide-line">
                {inspections.map((i) => (
                  <li key={i.inspectionId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {i.inspectionId} <span className="font-normal text-muted">· {i.source === 'VOICE' ? 'voice report' : 'manual'} by {i.reportedBy?.name}</span>
                      </p>
                      <ul className="mt-1 text-sm text-muted">
                        {i.issues.map((x) => (
                          <li key={x.area + x.description}>
                            {x.area.charAt(0).toUpperCase() + x.area.slice(1)}: {x.description} <span className="text-faint">({x.severity})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="text-right">
                      <Badge tone={i.status === 'OPEN' ? 'warn' : i.status === 'CONVERTED' ? 'brand' : 'ok'}>{i.status === 'CONVERTED' ? `On ${i.serviceTaskId}` : i.status.toLowerCase()}</Badge>
                      <p className="mt-1 text-xs text-faint">{shortDate(i.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No inspections" message="Inspections from voice reports and manual checks appear here." />
            )}
          </Panel>

          <Panel id="service-history" title="Service history" bodyClassName="p-0">
            {tasks.length ? (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.taskId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {t.taskId} · {t.issue}
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {t.bay ? `${bayName(t.bay)} · ` : ''}
                        {t.technicianName || 'Unassigned'}
                        {t.scheduledTime ? ` · ${dayClock(t.scheduledTime)}` : ''}
                      </p>
                      {t.requiredParts.length > 0 && <p className="mt-1 text-xs text-faint">Parts: {t.requiredParts.map((p) => `${p.name} (${p.status.toLowerCase().replace(/_/g, ' ')})`).join(', ')}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={t.priority} />
                      <TaskBadge status={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No service work" message="Repair orders for this vehicle appear here." />
            )}
          </Panel>

          <Panel id="ai-insights" title="AI insights">
            {aging ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={aging.risk === 'HIGH' ? 'bad' : aging.risk === 'MEDIUM' ? 'warn' : 'neutral'}>Aging risk: {aging.risk.toLowerCase()}</Badge>
                  <span className="text-xs text-faint">{aging.engine}</span>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed">{aging.summary}</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium">Why it is aging</p>
                    <ul className="mt-2 space-y-2">
                      {aging.reasons.map((r) => (
                        <li key={r.key} className="text-sm">
                          <span className="font-medium">{r.title}.</span> <span className="text-muted">{r.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Recommendations</p>
                    <ul className="mt-2 space-y-2">
                      {aging.recommendations.map((r) => (
                        <li key={r.key} className="flex gap-2 text-sm">
                          <Lightbulb className="mt-0.5 size-4 shrink-0 text-paint" />
                          <span>
                            <span className="font-medium">{r.title}.</span> <span className="text-muted">{r.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-faint">{aging.pricingNote}</p>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="space-y-2 text-sm">
                {Object.entries(v.healthBreakdown || {})
                  .filter(([, h]) => h.status !== 'ok')
                  .map(([k, h]) => (
                    <li key={k} className="flex gap-2">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-paint" />
                      <span>
                        <span className="font-medium capitalize">{k}:</span> <span className="text-muted">{h.note}</span>
                      </span>
                    </li>
                  ))}
                {Object.values(v.healthBreakdown || {}).every((h) => h.status === 'ok') && <li className="text-muted">No risks detected. This vehicle is front-line ready.</li>}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <Panel title="Health score">
            <div className="flex items-center gap-5">
              <HealthRing score={v.healthScore} size={108} stroke={10}>
                <span>
                  <span className="t-num block text-3xl font-bold">{v.healthScore}</span>
                  <span className="block text-xs text-muted">/ 100</span>
                </span>
              </HealthRing>
              <p className="text-sm text-muted">Location freshness, condition, photo coverage, listing quality and open service work.</p>
            </div>
            <div className="mt-4">
              <HealthBreakdown breakdown={v.healthBreakdown} />
            </div>
          </Panel>
          <Panel id="activity-timeline" title="Activity timeline" bodyClassName="max-h-[640px] overflow-y-auto scrollbar-thin">
            <Timeline items={[...activity].reverse()} compact />
          </Panel>
        </div>
      </div>
    </div>
  );
}
