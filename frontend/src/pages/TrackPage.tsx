import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Phone, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import type { CustomerStatusView } from '../types';
import { ServiceSteps } from '../components/VehicleBits';
import { StockTag } from '../components/StockTag';
import { Logo } from '../components/Logo';
import { clock, dayClock, timeAgo } from '../utils/format';

/** Public, customer-facing service tracker. No sign-in. Refreshes every 15 seconds. */
export default function TrackPage() {
  const { code = '' } = useParams();
  const [data, setData] = useState<CustomerStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .track(code)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          setRefreshedAt(new Date());
        })
        .catch((err) => alive && setError(errorMessage(err)));
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code]);

  const ready = data?.stage === 'READY';

  return (
    <div
      className="min-h-screen bg-[#f3f4f6] text-[#141a21]"
      style={{ colorScheme: 'light', ['--bg' as string]: '#f3f4f6', ['--surface' as string]: '#ffffff', ['--surface-2' as string]: '#f5f6f8', ['--line' as string]: '#e1e5ea', ['--ink' as string]: '#141a21', ['--muted' as string]: '#566170', ['--faint' as string]: '#8a94a3' }}
    >
      <div className="asphalt px-5 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <Logo compact />
          <span className="text-xs text-[#a7b0bc]">Service status</span>
        </div>
      </div>
      <main className="mx-auto max-w-lg px-5 py-6">
        {error && <p className="rounded-xl bg-white p-5 text-sm shadow-sm">{error}</p>}
        {!data && !error && <p className="text-sm text-[#566170]">Loading your vehicle status…</p>}
        {data && (
          <>
            <p className="text-sm text-[#566170]">Hi {data.firstName},</p>
            <h1 className="t-display mt-1 text-[28px]">{ready ? 'Your vehicle is ready' : data.stageLabel}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StockTag id={data.vehicleId} />
              <span className="text-sm font-medium">{data.vehicleLabel}</span>
            </div>

            {data.estimatedCompletion && (
              <div className="mt-5 flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <span className="grid size-11 place-items-center rounded-full bg-[#2f5bea]/10 text-[#2f5bea]">
                  <Clock className="size-5" />
                </span>
                <div>
                  <p className="text-sm text-[#566170]">{ready ? 'Ready since' : 'Estimated completion'}</p>
                  <p className="t-num text-2xl font-semibold">{ready ? clock(data.estimatedCompletion) : dayClock(data.estimatedCompletion)}</p>
                </div>
              </div>
            )}

            <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <p className="mb-4 text-xs font-medium text-[#566170]">Service status</p>
              <ServiceSteps steps={data.steps} compact />
            </div>

            {data.advisorNote && (
              <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                <p className="text-xs text-[#566170]">Note from {data.advisorName || 'your advisor'}</p>
                <p className="mt-1 text-[15px]">{data.advisorNote}</p>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <div>
                <p className="text-sm font-medium">{data.advisorName || 'Service desk'}</p>
                <p className="text-xs text-[#566170]">{data.dealership}</p>
              </div>
              <a href="tel:+918045678900" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#161b21] px-4 text-sm font-medium text-white">
                <Phone className="size-4" /> Call
              </a>
            </div>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[#8a94a3]">
              <RefreshCw className="size-3" /> Updates automatically · last checked {timeAgo(refreshedAt)} · changed {timeAgo(data.updatedAt)}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
