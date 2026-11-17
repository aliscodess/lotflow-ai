import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Car,
  ChartBar,
  ChevronDown,
  Ellipsis,
  LayoutDashboard,
  Leaf,
  LogOut,
  Map,
  Mic,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth, HOME_FOR_ROLE } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { api, errorMessage } from '../services/api';
import { cn, ROLE_LABEL, timeAgo } from '../utils/format';
import type { Role } from '../types';
import { Logo } from '../components/Logo';

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: typeof Car;
  roles: Role[];
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['MANAGER', 'SERVICE_ADVISOR'] },
  { to: '/voice', label: 'Voice assistant', short: 'Voice', icon: Mic, roles: ['LOT_ASSOCIATE', 'MANAGER'] },
  { to: '/lot', label: 'Lot', icon: Map, roles: ['MANAGER', 'LOT_ASSOCIATE', 'SERVICE_ADVISOR'] },
  { to: '/vehicles', label: 'Vehicles', icon: Car, roles: ['MANAGER', 'LOT_ASSOCIATE', 'SERVICE_ADVISOR'] },
  { to: '/service', label: 'Service', icon: Wrench, roles: ['MANAGER', 'SERVICE_ADVISOR'] },
  { to: '/actions', label: 'AI actions', short: 'Actions', icon: Sparkles, roles: ['MANAGER', 'SERVICE_ADVISOR'] },
  { to: '/analytics', label: 'Analytics', icon: ChartBar, roles: ['MANAGER'] },
  { to: '/customers', label: 'Customers', icon: Users, roles: ['MANAGER', 'SERVICE_ADVISOR'] },
  { to: '/sustainability', label: 'Sustainability', short: 'Green', icon: Leaf, roles: ['MANAGER'] },
];

const MOBILE_PRIMARY: Record<Role, string[]> = {
  MANAGER: ['/dashboard', '/lot', '/voice', '/actions'],
  LOT_ASSOCIATE: ['/voice', '/lot', '/vehicles'],
  SERVICE_ADVISOR: ['/service', '/actions', '/customers', '/lot'],
};

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut]);
}

function DemoBadge() {
  const { system } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  if (!system?.demoMode) return null;
  return (
    <div ref={ref} className="relative hidden md:block">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-line ring-inset hover:text-ink">
        <span className="size-1.5 rounded-full bg-paint" />
        Demo environment
      </button>
      {open && (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-80 rounded-xl border border-line bg-surface p-4 text-sm shadow-xl">
          <p className="font-semibold">Prototype with simulated enterprise integrations</p>
          <p className="mt-1.5 text-muted">DMS inventory, parts warehouses and customer messaging are simulated with realistic data for Tekion Demo Motors. Every workflow writes to the live database.</p>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-faint">AI engine</dt>
              <dd className="text-right">{system.ai.label}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-faint">Model</dt>
              <dd className="text-right">{system.ai.model}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-faint">Photo storage</dt>
              <dd>{system.storage === 'cloudinary' ? 'Cloudinary' : 'Local server'}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const { notifications, unread, markAllRead, connected } = useRealtime();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(markAllRead, 1500);
        }}
        className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      >
        <Bell className="size-5" />
        {unread > 0 && <span className="t-num absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="animate-rise absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold">Notifications</p>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className={cn('size-1.5 rounded-full', connected ? 'bg-ok' : 'bg-warn')} />
              {connected ? 'Live' : 'Reconnecting'}
            </span>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {notifications.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">New alerts and workflow updates appear here as they happen.</li>}
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (n.link) navigate(n.link);
                    setOpen(false);
                  }}
                  className={cn('block w-full px-4 py-3 text-left hover:bg-surface-2', !n.read && 'bg-paint/5')}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-faint">{timeAgo(n.at)}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout, demoLogin, system } = useAuth();
  const { theme, toggle } = useTheme();
  const { push } = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  if (!user) return null;

  const switchTo = async (role: Role) => {
    setBusy(role);
    try {
      await demoLogin(role);
      setOpen(false);
      navigate(HOME_FOR_ROLE[role]);
    } catch (err) {
      push({ title: 'Could not switch role', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    if (!window.confirm('Restore the demo dataset? All changes made during this session will be replaced.')) return;
    setBusy('reset');
    try {
      await api.resetDemo();
      push({ title: 'Demo data restored', kind: 'success' });
      setOpen(false);
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      push({ title: 'Reset failed', message: errorMessage(err), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg py-1 pr-1.5 pl-1 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid size-8 place-items-center rounded-full bg-asphalt text-xs font-bold text-paint ring-1 ring-line">
          {user.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)}
        </span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block text-xs text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-faint lg:block" />
      </button>
      {open && (
        <div role="menu" className="animate-rise absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="px-2.5 py-2">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
          {system?.demoMode && (
            <div className="border-t border-line py-1.5">
              <p className="px-2.5 pt-1 pb-1.5 text-xs text-faint">Switch demo role</p>
              {(['MANAGER', 'LOT_ASSOCIATE', 'SERVICE_ADVISOR'] as Role[]).map((r) => (
                <button key={r} type="button" disabled={r === user.role || busy !== null} onClick={() => switchTo(r)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
                  {ROLE_LABEL[r]}
                  {r === user.role && <span className="text-xs text-faint">Current</span>}
                  {busy === r && <span className="text-xs text-faint">Switching…</span>}
                </button>
              ))}
            </div>
          )}
          <div className="border-t border-line pt-1.5">
            <button type="button" onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
            {user.role === 'MANAGER' && system?.demoMode && (
              <button type="button" onClick={reset} disabled={busy !== null} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2">
                <RotateCcw className="size-4" />
                {busy === 'reset' ? 'Restoring…' : 'Reset demo data'}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-bad hover:bg-bad/10"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5" aria-label="Main">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] transition-colors',
              isActive ? 'bg-white/[0.07] font-medium text-white' : 'text-[#a7b0bc] hover:bg-white/[0.04] hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className={cn('absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-paint transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
              <item.icon className={cn('size-[18px]', isActive ? 'text-paint' : '')} />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = NAV.filter((n) => user && n.roles.includes(user.role));
  const primary = user ? items.filter((i) => MOBILE_PRIMARY[user.role].includes(i.to)) : [];
  const isVoice = pathname.startsWith('/voice');

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:pl-[248px]">
      {/* Desktop sidebar */}
      <aside className="asphalt fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-black/40 lg:flex">
        <div className="px-5 pt-5 pb-6">
          <Link to="/" aria-label="LotFlow AI home">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav items={items} />
        </div>
        <div className="m-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06]">
          <p className="text-xs text-[#8b95a3]">Dealership</p>
          <p className="mt-0.5 text-sm font-medium text-white">Tekion Demo Motors</p>
          <p className="text-xs text-[#8b95a3]">Whitefield, Bengaluru</p>
        </div>
      </aside>

      {/* Top bar */}
      <header className={cn('sticky top-0 z-30 border-b backdrop-blur', isVoice ? 'border-white/10 bg-asphalt/90 text-white lg:border-line lg:bg-bg/85 lg:text-ink' : 'border-line bg-bg/85')}>
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="lg:hidden" aria-label="Home">
            <Logo compact dark={isVoice} />
          </Link>
          <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
            <span className="text-muted">Dealership:</span>
            <span className="font-medium">Tekion Demo Motors</span>
            <span className="text-faint">/</span>
            <span className="text-muted">Whitefield</span>
          </div>
          <div className="flex-1" />
          <DemoBadge />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>

      <main className={cn('pb-28 lg:px-8 lg:pt-7 lg:pb-12', isVoice ? 'px-0 pt-0' : 'px-4 pt-5 sm:px-6')}>
        <div className={cn('mx-auto', !isVoice && 'max-w-[1440px]')}>
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="asphalt fixed inset-x-0 bottom-0 z-40 border-t border-black/40 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Primary">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + (items.length > primary.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {primary.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px]', isActive ? 'text-paint' : 'text-[#a7b0bc]')}>
              <item.icon className="size-5" />
              {item.short || item.label}
            </NavLink>
          ))}
          {items.length > primary.length && (
            <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-[#a7b0bc]">
              <Ellipsis className="size-5" />
              More
            </button>
          )}
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setMoreOpen(false)} />
          <div className="asphalt animate-rise absolute inset-x-0 bottom-0 rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-lg p-1.5 text-[#a7b0bc]" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav items={items} onNavigate={() => setMoreOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
