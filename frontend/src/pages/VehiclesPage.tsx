import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Car, Search } from 'lucide-react';
import { api } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { EmptyState, ErrorState, Input, Meter, PageHeader, PageSkeleton, Segmented, Select } from '../components/ui';
import { StatusBadge } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { cn, healthColor, lakh, timeAgo } from '../utils/format';

type StatusFilter = 'ALL' | 'AVAILABLE' | 'INSPECTION_REQUIRED' | 'SERVICE' | 'HOLD' | 'SOLD';

export default function VehiclesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>((params.get('status') as StatusFilter) || 'ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('-daysInInventory');
  const [ownership, setOwnership] = useState<'INVENTORY' | 'ALL'>('INVENTORY');
  const list = useApi(() => api.vehicles({ ownership, sort }), [ownership, sort]);
  useLiveRefresh(['vehicle:updated', 'system:reset'], list.refetch);

  const items = useMemo(() => {
    let out = list.data?.items || [];
    if (status !== 'ALL') out = out.filter((v) => v.status === status);
    if (q) {
      const n = q.toLowerCase().replace('#', '');
      out = out.filter((v) => `${v.vehicleId} ${v.make} ${v.model} ${v.variant} ${v.color}`.toLowerCase().includes(n));
    }
    return out;
  }, [list.data, status, q]);

  const count = (s: StatusFilter) => (list.data?.items || []).filter((v) => s === 'ALL' || v.status === s).length;

  return (
    <div>
      <PageHeader title="Vehicles" description="Every vehicle on the Whitefield lot, with health, location and time in stock." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<StatusFilter>
          value={status}
          onChange={(s) => {
            setStatus(s);
            setParams(s === 'ALL' ? {} : { status: s });
          }}
          options={[
            { value: 'ALL', label: 'All', count: count('ALL') },
            { value: 'AVAILABLE', label: 'Available', count: count('AVAILABLE') },
            { value: 'INSPECTION_REQUIRED', label: 'Inspection', count: count('INSPECTION_REQUIRED') },
            { value: 'SERVICE', label: 'Service', count: count('SERVICE') },
            { value: 'HOLD', label: 'Hold', count: count('HOLD') },
            { value: 'SOLD', label: 'Sold', count: count('SOLD') },
          ]}
        />
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock no., make, model" className="pl-9" aria-label="Search vehicles" />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto" aria-label="Sort">
          <option value="-daysInInventory">Longest in stock</option>
          <option value="healthScore">Lowest health</option>
          <option value="-healthScore">Highest health</option>
          <option value="vehicleId">Stock number</option>
          <option value="-updatedAt">Recently updated</option>
        </Select>
        <Select value={ownership} onChange={(e) => setOwnership(e.target.value as 'INVENTORY' | 'ALL')} className="w-auto" aria-label="Ownership">
          <option value="INVENTORY">Inventory only</option>
          <option value="ALL">Include customer vehicles</option>
        </Select>
      </div>

      {list.loading ? (
        <PageSkeleton />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface">
          <EmptyState icon={<Car className="size-8" />} title="No vehicles match" message="Try a different status or search term." />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3 font-medium">Days in stock</th>
                  <th className="px-4 py-3 font-medium">Photos · listing</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((v) => {
                  const aging = v.daysInInventory !== null && v.daysInInventory > v.expectedDaysToSell;
                  return (
                    <tr key={v.vehicleId} onClick={() => navigate(`/vehicles/${v.vehicleId}`)} className="cursor-pointer hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <StockTag id={v.vehicleId} size="sm" />
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/vehicles/${v.vehicleId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {v.year} {v.make} {v.model}
                        </Link>
                        <p className="text-xs text-muted">
                          {v.variant} · {v.color}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{v.location.zone === 'SERVICE' ? 'Service area' : v.location.row ? `${v.location.row}${v.location.position}` : 'Unassigned'}</span>
                        <p className="text-xs text-faint">{timeAgo(v.lastSeenAt)}</p>
                      </td>
                      <td className="w-36 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="t-num w-7 font-semibold">{v.healthScore}</span>
                          <Meter value={v.healthScore} color={healthColor(v.healthScore)} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {v.daysInInventory !== null ? (
                          <span className={cn('t-num', aging && 'font-semibold text-warn')}>
                            {v.daysInInventory}
                            <span className="font-normal text-faint"> / {v.expectedDaysToSell}</span>
                          </span>
                        ) : (
                          <span className="text-faint">Customer</span>
                        )}
                      </td>
                      <td className="t-num px-4 py-3 text-muted">
                        {v.ownership === 'INVENTORY' ? `${v.photoCount} · ${v.listingCompleteness}%` : '—'}
                      </td>
                      <td className="t-num px-4 py-3 text-right">{v.ownership === 'INVENTORY' ? lakh(v.listPriceINR) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {items.map((v) => (
              <li key={v.vehicleId}>
                <Link to={`/vehicles/${v.vehicleId}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
                  <StockTag id={v.vehicleId} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {v.year} {v.make} {v.model}
                    </p>
                    <p className="text-xs text-muted">
                      {v.location.zone === 'SERVICE' ? 'Service area' : `${v.location.row ?? '—'}${v.location.position ?? ''}`} · {v.daysInInventory ?? '—'} days
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={v.status} />
                    <p className="t-num mt-1 text-xs" style={{ color: healthColor(v.healthScore) }}>
                      {v.healthScore}/100
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
