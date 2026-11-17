import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Check, CircleAlert, ImagePlus, Keyboard, LoaderCircle, Mic, Pencil, Plus, RotateCcw, Square, Trash2, TriangleAlert, X } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { useApi, useLiveRefresh } from '../hooks/useApi';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useToast } from '../context/ToastContext';
import { StockTag } from '../components/StockTag';
import { cn, timeAgo, VEHICLE_STATUS } from '../utils/format';
import type { Issue, Observation, VoicePreview, VoiceProcessResult } from '../types';

type Stage = 'capture' | 'processing' | 'review' | 'applying' | 'done';

const PROCESS_STEPS = ['Understanding vehicle', 'Extracting location', 'Detecting issues', 'Assigning severity', 'Checking inventory'];
const ACTIONS = [
  ['inspection_required', 'Inspection required'],
  ['service_required', 'Send to service'],
  ['location_update', 'Location update only'],
  ['mark_available', 'Mark front-line ready'],
  ['hold', 'Put on hold'],
  ['mark_sold', 'Mark as sold'],
] as const;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SEVERITY_STYLE = { low: 'bg-[#3a4350] text-[#d4dae2]', medium: 'bg-warn/20 text-[#ffb547]', high: 'bg-bad/25 text-[#ff8a8d]' };
const HIGHLIGHT_STYLE: Record<string, string> = {
  vehicle: 'bg-paint text-asphalt rounded-[3px] px-0.5 font-semibold',
  location: 'bg-brand/30 text-white rounded-[3px] px-0.5',
  issue: 'bg-transparent text-white underline decoration-warn decoration-2 underline-offset-4',
  condition: 'bg-transparent text-white underline decoration-bad/80 decoration-2 underline-offset-4',
  action: 'bg-ok/25 text-white rounded-[3px] px-0.5',
};

function Waveform({ active, level }: { active: boolean; level: number }) {
  const bars = 28;
  return (
    <div className="flex h-12 items-center justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const centre = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const h = active ? 18 + centre * 70 * (0.6 + level * 0.4) : 8;
        return (
          <span
            key={i}
            className={cn('w-[3px] origin-center rounded-full bg-paint transition-all duration-300', active ? 'animate-wave' : 'opacity-30')}
            style={{ height: `${h}%`, animationDelay: `${(i % 7) * 90}ms`, animationDuration: `${700 + (i % 5) * 120}ms` }}
          />
        );
      })}
    </div>
  );
}

function HighlightedTranscript({ text, highlights }: { text: string; highlights: VoiceProcessResult['highlights'] }) {
  const parts = useMemo(() => {
    const out: { text: string; type?: string }[] = [];
    let cursor = 0;
    for (const h of [...highlights].sort((a, b) => a.start - b.start)) {
      if (h.start < cursor) continue;
      if (h.start > cursor) out.push({ text: text.slice(cursor, h.start) });
      out.push({ text: text.slice(h.start, h.end), type: h.type });
      cursor = h.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  }, [text, highlights]);
  return (
    <p className="text-[15px] leading-relaxed text-[#cfd6de]">
      “{parts.map((p, i) => (p.type ? <mark key={i} className={HIGHLIGHT_STYLE[p.type] || 'bg-transparent text-inherit'}>{p.text}</mark> : <span key={i}>{p.text}</span>))}”
    </p>
  );
}

export default function VoiceAssistantPage() {
  const { push } = useToast();
  const speech = useSpeechRecognition('en-IN');
  const samples = useApi(() => api.voiceSamples(), []);
  const recent = useApi(() => api.voiceRecent(), []);
  useLiveRefresh(['activity:new', 'system:reset'], recent.refetch);

  const [stage, setStage] = useState<Stage>('capture');
  const [typing, setTyping] = useState(!speech.supported);
  const [text, setText] = useState('');
  const [result, setResult] = useState<VoiceProcessResult | null>(null);
  const [draft, setDraft] = useState<Observation | null>(null);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [editing, setEditing] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState<{ steps: { key: string; label: string; detail: string }[]; vehicleId: string } | null>(null);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const process = useCallback(
    async (transcript: string) => {
      const clean = transcript.trim();
      if (clean.length < 3) {
        setProcessError('Say or type an observation first.');
        return;
      }
      setProcessError(null);
      setStage('processing');
      setStepIndex(0);
      const ticker = setInterval(() => setStepIndex((i) => Math.min(i + 1, PROCESS_STEPS.length)), 260);
      try {
        const [res] = await Promise.all([api.voiceProcess(clean), new Promise((r) => setTimeout(r, 1400))]);
        setResult(res);
        setDraft(res.parsed);
        setPreview(res.preview);
        setEditing(!res.preview.ok && Boolean(res.parsed));
        setStage('review');
      } catch (err) {
        setProcessError(errorMessage(err));
        setStage('capture');
      } finally {
        clearInterval(ticker);
      }
    },
    [],
  );

  const toggleMic = () => {
    if (speech.state === 'listening') speech.stop();
    else {
      setProcessError(null);
      speech.start((finalText) => {
        setText(finalText);
        process(finalText);
      });
    }
  };

  const addPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const next = Array.from(files)
      .slice(0, 6 - photos.length)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
  };

  const refreshPreview = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.voicePreview(draft);
      setDraft(r.parsed);
      setPreview(r.preview);
      if (r.preview.ok) setEditing(false);
    } catch (err) {
      push({ title: 'Could not check the changes', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!draft || !result) return;
    setStage('applying');
    let uploaded: { url: string; label: string }[] = [];
    if (photos.length) {
      try {
        const r = await api.upload(photos.map((p) => p.file));
        uploaded = r.files.map((f) => ({ url: f.url, label: 'Lot walk photo' }));
      } catch (err) {
        push({ title: 'Photos were not attached', message: `${errorMessage(err)} The update will continue without them.`, kind: 'error' });
      }
    }
    try {
      const r = await api.voiceConfirm({ parsed: draft, transcript: result.transcript, photos: uploaded, ai: result.ai });
      setDone({ steps: r.steps, vehicleId: r.vehicle.vehicleId });
      setStage('done');
      recent.refetch();
    } catch (err) {
      push({ title: 'Update failed', message: errorMessage(err), kind: 'error' });
      setStage('review');
    }
  };

  const reset = () => {
    speech.cancel();
    setStage('capture');
    setText('');
    setResult(null);
    setDraft(null);
    setPreview(null);
    setDone(null);
    setEditing(false);
    setPhotos([]);
    setProcessError(null);
  };

  const updateIssue = (i: number, patch: Partial<Issue>) => setDraft((d) => (d ? { ...d, issues: d.issues.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : d));

  const listening = speech.state === 'listening';
  const ai = result?.ai;

  return (
    <div className="asphalt min-h-[calc(100dvh-56px)] text-white lg:min-h-[calc(100vh-130px)] lg:rounded-3xl lg:ring-1 lg:ring-black/30">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 pt-6 pb-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10 lg:p-10">
        {/* ---------------- Main stage ---------------- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[#a7b0bc]">Voice lot assistant</p>
            {samples.data?.ai && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-[#c3cad3] ring-1 ring-white/10">
                <span className={cn('size-1.5 rounded-full', samples.data.ai.mode === 'live' ? 'bg-ok' : 'bg-paint')} />
                {samples.data.ai.label}
              </span>
            )}
          </div>

          {stage === 'capture' && (
            <div className="animate-rise">
              <h1 className="t-display mt-3 text-[36px] sm:text-5xl">Tell me what you see</h1>
              <p className="mt-3 max-w-md text-[15px] text-[#a7b0bc]">Say the stock number, where it is parked, and anything that needs attention. LotFlow updates the lot and the service team.</p>

              {!typing && (
                <div className="mt-8 flex flex-col items-center">
                  <div className="relative grid size-[232px] place-items-center">
                    {/* Painted lot circle */}
                    <svg viewBox="0 0 232 232" className="absolute inset-0" aria-hidden="true">
                      <circle cx="116" cy="116" r="110" fill="none" stroke="var(--color-paint)" strokeWidth="5" strokeDasharray="22 12" opacity={listening ? 1 : 0.85} />
                    </svg>
                    {listening && <span className="animate-ring absolute size-[160px] rounded-full bg-paint/40" />}
                    <button
                      type="button"
                      onClick={toggleMic}
                      aria-pressed={listening}
                      aria-label={listening ? 'Stop listening' : 'Start speaking'}
                      className={cn(
                        'relative grid size-[156px] place-items-center rounded-full transition-all duration-200 focus-visible:outline-offset-8',
                        listening ? 'scale-105 bg-paint text-asphalt shadow-[0_0_60px_rgba(242,194,48,0.35)]' : 'bg-asphalt-3 text-paint shadow-[inset_0_2px_0_rgba(255,255,255,0.06),0_12px_30px_rgba(0,0,0,0.45)] hover:bg-[#2e3843]',
                      )}
                    >
                      {listening ? <Square className="size-10 fill-current" /> : <Mic className="size-14" strokeWidth={1.8} />}
                    </button>
                  </div>
                  <p className="mt-5 text-[15px] font-medium">{listening ? 'Listening…' : 'Tap to speak'}</p>
                  <p className="text-sm text-[#8b95a3]">{listening ? 'Tap again when you are done' : 'Hands-free: speak naturally, the way you would on a radio'}</p>
                  <div className="mt-4 w-full max-w-sm">
                    <Waveform active={listening} level={speech.level} />
                  </div>
                  {(speech.transcript || speech.interim) && (
                    <p className="mt-3 max-w-xl text-center text-[15px] leading-relaxed">
                      {speech.transcript} <span className="text-[#8b95a3]">{speech.interim}</span>
                    </p>
                  )}
                </div>
              )}

              {typing && (
                <div className="mt-8">
                  <label htmlFor="obs" className="text-sm text-[#a7b0bc]">
                    {speech.supported ? 'Type what you would normally say' : 'Voice input is not supported in this browser. Type what you would normally say:'}
                  </label>
                  <textarea
                    id="obs"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) process(text);
                    }}
                    rows={4}
                    placeholder="Vehicle 2847 is in row B position 12. There is a scratch on the front bumper…"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-[15px] text-white placeholder:text-[#6c7786] focus:border-paint/60 focus:ring-2 focus:ring-paint/20 focus:outline-none"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => process(text)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-paint px-5 font-semibold text-asphalt hover:bg-[#ffd14a]">
                      Process observation <ArrowRight className="size-4" />
                    </button>
                    <span className="text-xs text-[#6c7786]">Ctrl + Enter</span>
                  </div>
                </div>
              )}

              {(speech.error || processError) && (
                <div role="alert" className="mt-5 flex gap-2.5 rounded-xl bg-warn/12 p-3 text-sm text-[#ffd18a] ring-1 ring-warn/30">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span className="flex-1">{processError || speech.error}</span>
                  {!typing && (
                    <button type="button" className="font-semibold underline" onClick={() => setTyping(true)}>
                      Type instead
                    </button>
                  )}
                </div>
              )}

              <div className="mt-7 flex flex-wrap gap-2">
                {speech.supported && (
                  <button type="button" onClick={() => setTyping((t) => !t)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/5 px-3.5 text-sm ring-1 ring-white/10 hover:bg-white/10">
                    {typing ? <Mic className="size-4" /> : <Keyboard className="size-4" />}
                    {typing ? 'Use voice' : 'Type instead'}
                  </button>
                )}
                <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/5 px-3.5 text-sm ring-1 ring-white/10 hover:bg-white/10">
                  <Camera className="size-4" /> Take photo
                </button>
                <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/5 px-3.5 text-sm ring-1 ring-white/10 hover:bg-white/10">
                  <ImagePlus className="size-4" /> Upload photo
                </button>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPhotos(e.target.files)} />
                <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
              </div>

              {photos.length > 0 && <PhotoStrip photos={photos} onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))} />}

              {samples.data?.samples && (
                <div className="mt-8">
                  <p className="text-sm text-[#8b95a3]">Try a sample observation</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {samples.data.samples.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setText(s.text);
                          setTyping(true);
                          process(s.text);
                        }}
                        className="rounded-full border border-dashed border-paint/50 px-3 py-1.5 text-[13px] text-[#e9d38a] hover:border-paint hover:bg-paint/10"
                        title={s.text}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {stage === 'processing' && (
            <div className="animate-rise mt-6 max-w-xl">
              <h1 className="t-display text-3xl sm:text-4xl">Processing observation…</h1>
              <p className="mt-3 text-[15px] text-[#a7b0bc]">“{text || speech.transcript}”</p>
              <ul className="mt-8 space-y-3">
                {PROCESS_STEPS.map((s, i) => (
                  <li key={s} className={cn('flex items-center gap-3 text-[15px] transition-opacity', i <= stepIndex ? 'opacity-100' : 'opacity-35')}>
                    <span className={cn('grid size-6 place-items-center rounded-full', i < stepIndex ? 'bg-ok text-white' : 'ring-1 ring-white/25')}>
                      {i < stepIndex ? <Check className="size-3.5" strokeWidth={3} /> : i === stepIndex ? <LoaderCircle className="size-3.5 animate-spin text-paint" /> : null}
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(stage === 'review' || stage === 'applying') && result && draft && preview && (
            <div className="animate-rise mt-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h1 className="t-display text-3xl sm:text-4xl">I understood</h1>
                {ai && (
                  <span className="text-xs text-[#8b95a3]">
                    {ai.confidence ? `${Math.round(ai.confidence * 100)}% confidence · ` : ''}
                    {ai.engine} · {ai.latencyMs} ms{ai.mode === 'fallback' ? ' · fallback' : ''}
                  </span>
                )}
              </div>
              <div className="mt-4 rounded-2xl bg-black/25 p-4 ring-1 ring-white/10">
                <HighlightedTranscript text={result.transcript} highlights={result.highlights} />
              </div>

              {!editing ? (
                <ReviewCard draft={draft} preview={preview} />
              ) : (
                <EditForm draft={draft} setDraft={setDraft} updateIssue={updateIssue} />
              )}

              {preview.errors.length > 0 && (
                <div role="alert" className="mt-4 space-y-1.5 rounded-xl bg-bad/15 p-3 text-sm text-[#ffb3b5] ring-1 ring-bad/30">
                  {preview.errors.map((e) => (
                    <p key={e.message} className="flex gap-2">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      {e.message}
                    </p>
                  ))}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <div className="mt-3 space-y-1.5 rounded-xl bg-warn/10 p-3 text-sm text-[#ffd18a] ring-1 ring-warn/25">
                  {preview.warnings.map((w) => (
                    <p key={w} className="flex gap-2">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {photos.length > 0 && <PhotoStrip photos={photos} onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))} />}

              <div className="mt-6 flex flex-wrap gap-2.5">
                {editing ? (
                  <button type="button" onClick={refreshPreview} disabled={busy} className="inline-flex h-12 items-center gap-2 rounded-xl bg-paint px-6 font-semibold text-asphalt hover:bg-[#ffd14a] disabled:opacity-60">
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Check changes
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={!preview.ok || stage === 'applying'}
                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-paint px-6 font-semibold text-asphalt hover:bg-[#ffd14a] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {stage === 'applying' ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />}
                    {stage === 'applying' ? 'Updating…' : 'Confirm update'}
                  </button>
                )}
                {!editing && (
                  <button type="button" onClick={() => setEditing(true)} className="inline-flex h-12 items-center gap-2 rounded-xl bg-white/5 px-5 ring-1 ring-white/15 hover:bg-white/10">
                    <Pencil className="size-4" /> Edit
                  </button>
                )}
                <button type="button" onClick={reset} className="inline-flex h-12 items-center gap-2 rounded-xl px-4 text-[#a7b0bc] hover:text-white">
                  <RotateCcw className="size-4" /> Start over
                </button>
              </div>
            </div>
          )}

          {stage === 'done' && done && (
            <div className="animate-rise mt-6 max-w-xl">
              <span className="grid size-14 place-items-center rounded-full bg-ok text-white">
                <Check className="size-8" strokeWidth={3} />
              </span>
              <h1 className="t-display mt-5 text-3xl sm:text-4xl">Done. The team has it.</h1>
              <ul className="mt-6 space-y-3">
                {done.steps.map((s, i) => (
                  <li key={s.key} className="animate-rise flex gap-3" style={{ animationDelay: `${i * 140}ms` }}>
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ok/20 text-ok">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                    <span>
                      <span className="block font-semibold">{s.label}</span>
                      <span className="block text-sm text-[#a7b0bc]">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-2.5">
                <button type="button" onClick={reset} className="inline-flex h-12 items-center gap-2 rounded-xl bg-paint px-6 font-semibold text-asphalt hover:bg-[#ffd14a]">
                  <Mic className="size-4" /> Report another vehicle
                </button>
                <Link to={`/vehicles/${done.vehicleId}`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-white/5 px-5 ring-1 ring-white/15 hover:bg-white/10">
                  Open vehicle <StockTag id={done.vehicleId} size="sm" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* ---------------- Recent updates ---------------- */}
        <aside className="min-w-0 lg:border-l lg:border-white/10 lg:pl-8">
          <h2 className="t-title text-[15px]">Recent updates</h2>
          <p className="mt-0.5 text-sm text-[#8b95a3]">From voice reports across the lot</p>
          <ul className="mt-4 divide-y divide-white/[0.07]">
            {recent.loading && <li className="py-6 text-sm text-[#8b95a3]">Loading…</li>}
            {recent.error && <li className="py-6 text-sm text-[#ffb3b5]">{recent.error}</li>}
            {!recent.loading && !recent.data?.items.length && <li className="py-6 text-sm text-[#8b95a3]">Voice reports will appear here.</li>}
            {recent.data?.items.slice(0, 9).map((a) => (
              <li key={a._id} className="animate-rise flex items-start gap-3 py-3">
                {a.vehicleId && <StockTag id={a.vehicleId} size="sm" link />}
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-[#e3e8ee]">{a.message}</p>
                  <p className="mt-0.5 text-xs text-[#7d8794]">
                    {timeAgo(a.createdAt)}
                    {a.actor?.name ? ` · ${a.actor.name}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function PhotoStrip({ photos, onRemove }: { photos: { url: string }[]; onRemove: (i: number) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {photos.map((p, i) => (
        <div key={p.url} className="relative">
          <img src={p.url} alt={`Attached photo ${i + 1}`} className="size-20 rounded-lg object-cover ring-1 ring-white/15" />
          <button type="button" onClick={() => onRemove(i)} aria-label="Remove photo" className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-asphalt text-white ring-1 ring-white/20">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3.5 sm:grid-cols-[120px_1fr] sm:gap-4">
      <dt className="text-sm text-[#8b95a3]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ReviewCard({ draft, preview }: { draft: Observation; preview: VoicePreview }) {
  const loc = preview.changes.find((c) => c.field === 'location');
  const status = preview.vehicle ? VEHICLE_STATUS[preview.vehicle.status] : null;
  return (
    <dl className="mt-5 divide-y divide-white/[0.08] rounded-2xl bg-white/[0.03] px-5 ring-1 ring-white/10">
      <Row label="Vehicle">
        {preview.vehicle ? (
          <div className="flex flex-wrap items-center gap-3">
            <StockTag id={preview.vehicle.vehicleId} size="lg" />
            <div>
              <p className="font-semibold">{preview.vehicle.label}</p>
              <p className="text-sm text-[#8b95a3]">
                {preview.vehicle.type} · {preview.vehicle.color} · currently {status?.label.toLowerCase()}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[#ffb3b5]">{draft.vehicleId ? `#${draft.vehicleId} not found` : 'Not heard'}</p>
        )}
      </Row>
      {loc && (
        <Row label="Location">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            <span>Row {draft.location?.row}</span>
            <ArrowRight className="size-4 text-paint" />
            <span>Position {draft.location?.position}</span>
            {loc.changed && (
              <span className="ml-1 rounded-md bg-white/5 px-2 py-0.5 text-xs text-[#a7b0bc] ring-1 ring-white/10">
                moved from {loc.from}
              </span>
            )}
          </p>
        </Row>
      )}
      {draft.issues.length > 0 && (
        <Row label="Condition">
          <ul className="space-y-2">
            {draft.issues.map((i) => (
              <li key={`${i.area}-${i.description}`} className="flex flex-wrap items-center gap-2 text-[15px]">
                <span>{sentence(i.area)}</span>
                <ArrowRight className="size-4 text-paint" />
                <span>{sentence(i.description)}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium capitalize', SEVERITY_STYLE[i.severity])}>{i.severity}</span>
              </li>
            ))}
          </ul>
        </Row>
      )}
      <Row label="Action">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{preview.actionLabel}</span>
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-[#c3cad3] ring-1 ring-white/10">{sentence(draft.priority)} priority</span>
        </div>
        {preview.effects.length > 0 && <p className="mt-1.5 text-sm text-[#8b95a3]">On confirm: {preview.effects.join(', ').toLowerCase()}.</p>}
      </Row>
      {preview.health && (
        <Row label="Health score">
          <p className="t-num text-[15px]">
            {preview.health.from} <ArrowRight className="inline size-4 text-paint" /> <span className="font-semibold">{preview.health.to}</span>
            <span className="text-[#8b95a3]"> / 100</span>
          </p>
        </Row>
      )}
    </dl>
  );
}

function EditForm({ draft, setDraft, updateIssue }: { draft: Observation; setDraft: React.Dispatch<React.SetStateAction<Observation | null>>; updateIssue: (i: number, p: Partial<Issue>) => void }) {
  const field = 'w-full rounded-lg border border-white/10 bg-black/30 px-3 h-10 text-sm text-white focus:border-paint/60 focus:outline-none';
  return (
    <div className="mt-5 space-y-4 rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-[#8b95a3]">Stock number</span>
          <input className={field} value={draft.vehicleId || ''} onChange={(e) => setDraft({ ...draft, vehicleId: e.target.value.replace(/[^0-9A-Za-z]/g, '') || null })} placeholder="2847" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[#8b95a3]">Row</span>
          <select className={field} value={draft.location?.row || ''} onChange={(e) => setDraft({ ...draft, location: e.target.value ? { row: e.target.value, position: draft.location?.position || 1 } : null })}>
            <option value="">No change</option>
            {['A', 'B', 'C', 'D', 'E', 'F'].map((r) => (
              <option key={r} value={r}>
                Row {r}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[#8b95a3]">Position</span>
          <select className={field} disabled={!draft.location} value={draft.location?.position || ''} onChange={(e) => draft.location && setDraft({ ...draft, location: { ...draft.location, position: Number(e.target.value) } })}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-[#8b95a3]">Condition issues</p>
        <div className="space-y-2">
          {draft.issues.map((issue, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_120px_auto]">
              <input className={field} value={issue.area} onChange={(e) => updateIssue(i, { area: e.target.value })} placeholder="Area, e.g. front bumper" aria-label="Area" />
              <input className={field} value={issue.description} onChange={(e) => updateIssue(i, { description: e.target.value })} placeholder="What you see" aria-label="Description" />
              <select className={cn(field, 'col-span-2 sm:col-span-1')} value={issue.severity} onChange={(e) => updateIssue(i, { severity: e.target.value as Issue['severity'] })} aria-label="Severity">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button type="button" onClick={() => setDraft({ ...draft, issues: draft.issues.filter((_, j) => j !== i) })} className="row-start-1 grid size-10 place-items-center rounded-lg text-[#a7b0bc] hover:bg-white/5 hover:text-white sm:row-start-auto" aria-label="Remove issue" style={{ gridColumnStart: 3 }}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setDraft({ ...draft, issues: [...draft.issues, { area: '', description: '', severity: 'low' }] })} className="mt-2 inline-flex items-center gap-1.5 text-sm text-paint hover:underline">
          <Plus className="size-4" /> Add issue
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-[#8b95a3]">Action</span>
          <select className={field} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            {ACTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-[#8b95a3]">Priority</span>
          <select className={field} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
            {['low', 'medium', 'high', 'urgent'].map((p) => (
              <option key={p} value={p} className="capitalize">
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
