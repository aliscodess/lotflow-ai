import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { connectSocket, disconnectSocket } from '../services/socket';
import { lastMutationAt } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import type { Notification } from '../types';

type Handler = (payload: unknown) => void;

interface RealtimeState {
  connected: boolean;
  notifications: Notification[];
  unread: number;
  markAllRead: () => void;
  subscribe: (events: string[], handler: Handler) => () => void;
}

const RealtimeContext = createContext<RealtimeState | null>(null);

export const LIVE_EVENTS = ['vehicle:updated', 'alert:new', 'alert:updated', 'activity:new', 'service:updated', 'customer:updated', 'inspection:new', 'parts:updated', 'dashboard:refresh', 'system:reset'];

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { push } = useToast();
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const listeners = useRef(new Map<string, Set<Handler>>());

  useEffect(() => {
    if (!user) {
      setConnected(false);
      return;
    }
    const socket = connectSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onNotification = (n: Notification) => {
      setNotifications((list) => [{ ...n, read: false }, ...list].slice(0, 40));
      // The user already sees a local confirmation for actions they just took.
      if (Date.now() - lastMutationAt < 5000) return;
      push({ title: n.title, message: n.message, kind: n.kind === 'alert' || n.kind === 'warning' ? 'alert' : n.kind === 'success' ? 'success' : 'info', link: n.link });
    };
    const forward = (event: string) => (payload: unknown) => listeners.current.get(event)?.forEach((h) => h(payload));
    const forwarders = LIVE_EVENTS.map((e) => [e, forward(e)] as const);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on('notification', onNotification);
    forwarders.forEach(([e, fn]) => socket.on(e, fn));
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off('notification', onNotification);
      forwarders.forEach(([e, fn]) => socket.off(e, fn));
    };
  }, [user, push]);

  useEffect(() => () => disconnectSocket(), []);

  const subscribe = useCallback((events: string[], handler: Handler) => {
    events.forEach((e) => {
      if (!listeners.current.has(e)) listeners.current.set(e, new Set());
      listeners.current.get(e)!.add(handler);
    });
    return () => events.forEach((e) => listeners.current.get(e)?.delete(handler));
  }, []);

  const value: RealtimeState = {
    connected,
    notifications,
    unread: notifications.filter((n) => !n.read).length,
    markAllRead: () => setNotifications((list) => list.map((n) => ({ ...n, read: true }))),
    subscribe,
  };
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}
