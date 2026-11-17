import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, Mic, Wrench, LayoutDashboard } from 'lucide-react';
import { useAuth, HOME_FOR_ROLE } from '../context/AuthContext';
import { errorMessage } from '../services/api';
import { Button, Field, Input } from '../components/ui';
import { Logo } from '../components/Logo';
import { CarGlyph } from '../components/VehicleBits';
import type { Role } from '../types';

const ROLES: { role: Role; label: string; description: string; icon: typeof Mic }[] = [
  { role: 'MANAGER', label: 'Continue as Manager', description: 'Command center, AI actions, analytics and sustainability', icon: LayoutDashboard },
  { role: 'LOT_ASSOCIATE', label: 'Continue as Lot Associate', description: 'Walk the lot and report what you see by voice', icon: Mic },
  { role: 'SERVICE_ADVISOR', label: 'Continue as Service Advisor', description: 'Bays, technicians, parts and customer updates', icon: Wrench },
];

const STALL_COLORS = ['#1f9d63', '#1f9d63', '#e08a0b', '#1f9d63', null, '#7357e8', '#1f9d63', '#1f9d63', '#64748b', '#1f9d63'];

function LotIllustration() {
  return (
    <div className="relative mt-10 overflow-hidden rounded-2xl ring-1 ring-white/10" aria-hidden="true">
      <div className="asphalt relative px-5 pt-5 pb-3">
        <div className="grid grid-cols-10">
          {STALL_COLORS.map((c, i) => (
            <div key={i} className="relative flex h-24 items-end justify-center border-l-2 border-chalk/70 pb-1 last:border-r-2">
              {c ? <CarGlyph color={c} className="h-[74px]" /> : <span className="t-condensed mb-6 text-sm font-bold text-chalk/40">B12</span>}
              {i === 2 && <span className="t-condensed absolute top-1 rounded-[3px] bg-paint px-1 text-[11px] font-extrabold text-asphalt">#2847</span>}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded bg-paint/80" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { user, login, demoLogin, systemError, system } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showForm, setShowForm] = useState(false);

  if (user) return <Navigate to={HOME_FOR_ROLE[user.role]} replace />;

  const go = async (fn: () => Promise<{ role: Role }>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const u = await fn();
      navigate(HOME_FOR_ROLE[u.role], { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    go(() => login(email, password), 'form');
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="asphalt relative flex flex-col justify-between px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-12">
        <Logo />
        <div className="mt-12 max-w-xl lg:mt-0">
          <h1 className="t-display text-[34px] sm:text-5xl">Speak what you see. LotFlow handles the rest.</h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-[#b4bcc7]">
            LotFlow turns real-world dealership observations into structured inventory updates, proactive service actions, operational recommendations and customer communication.
          </p>
          <div className="hidden sm:block">
            <LotIllustration />
          </div>
        </div>
        <p className="mt-10 hidden text-xs text-[#7d8794] lg:block">AI-powered dealership operations from the lot to the service bay.</p>
      </section>

      <section className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <h2 className="t-title text-2xl">Sign in to Tekion Demo Motors</h2>
          <p className="mt-1.5 text-sm text-muted">Pick a role to explore the platform. No account needed.</p>

          {systemError && (
            <div role="alert" className="mt-5 flex gap-2.5 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
              <span>Cannot reach the LotFlow server. Start the backend (npm run dev in the backend folder) and refresh this page.</span>
            </div>
          )}

          <div className="mt-6 space-y-2.5">
            {ROLES.map((r) => (
              <button
                key={r.role}
                type="button"
                disabled={busy !== null}
                onClick={() => go(() => demoLogin(r.role), r.role)}
                className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand/50 hover:bg-surface-2 disabled:opacity-60"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-asphalt text-paint">
                  <r.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.label}</span>
                  <span className="block text-sm text-muted">{r.description}</span>
                </span>
                {busy === r.role ? (
                  <span className="size-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                ) : (
                  <ArrowRight className="size-5 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                )}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm text-bad">
              {error}
            </p>
          )}

          <div className="mt-8 border-t border-line pt-6">
            {!showForm ? (
              <button type="button" onClick={() => setShowForm(true)} className="text-sm font-medium text-brand hover:underline dark:text-brand-2">
                Sign in with email instead
              </button>
            ) : (
              <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="Email">
                  <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@lotflow.demo" />
                </Field>
                <Field label="Password" hint={system?.demoMode ? 'Demo accounts use the password Demo@123' : undefined}>
                  <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button type="submit" className="w-full" loading={busy === 'form'}>
                  Sign in
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
