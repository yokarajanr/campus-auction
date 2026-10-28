import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { AppNotification } from '../types';
import { NotifyIcon, notifyMeta, timeAgo } from '../notifyMeta';

type Permission = NotificationPermission | 'unsupported';

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [permission, setPermission] = useState<Permission>(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [newCount, setNewCount] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    api<{ notifications: AppNotification[]; unread: number }>('/notifications')
      .then((r) => { setItems(r.notifications); setUnread(r.unread); })
      .catch(() => {});

    const onNew = (n: AppNotification) => {
      setItems((current) => [n, ...current].slice(0, 50));
      setUnread((u) => u + 1);
      setToast(n);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const popup = new Notification(notifyMeta(n.type).title, { body: n.message, tag: `campus-auction-${n.id}`, icon: '/favicon.svg' });
        popup.onclick = () => {
          window.focus();
          if (n.auctionId) navigate(`/auctions/${n.auctionId}`);
          popup.close();
        };
      }
    };
    socket.on('notification', onNew);
    return () => { socket.off('notification', onNew); };
  }, [user, navigate]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!user) return null;

  function toggle() {
    setOpen((o) => !o);
    if (!open) setNewCount(unread);
    if (!open && unread > 0) {
      setUnread(0);
      api('/notifications/read', { method: 'POST' }).catch(() => {});
      setTimeout(() => setItems((current) => current.map((n) => ({ ...n, read: true }))), 3000);
    }
  }

  function go(n: AppNotification) {
    setOpen(false);
    setToast(null);
    if (n.auctionId) navigate(`/auctions/${n.auctionId}`);
  }

  async function enableBrowserAlerts() {
    setPermission(await Notification.requestPermission());
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button className="bell" onClick={toggle} aria-label={`Notifications (${unread} unread)`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown" role="dialog" aria-label="Notifications">
          <div className="dd-head">
            <h3>Notifications</h3>
            {newCount > 0 && <span className="dd-new">{newCount} new</span>}
          </div>

          {permission === 'default' && (
            <div className="dd-permission">
              <span className="notify-icon tone-primary" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              </span>
              <div>
                <strong>Get desktop alerts</strong>
                <p>See outbids and wins as system pop-ups, even when this tab is in the background.</p>
                <button className="btn small primary" onClick={enableBrowserAlerts}>Turn on</button>
              </div>
            </div>
          )}
          {permission === 'denied' && <p className="dd-status off">Desktop alerts are blocked. Allow notifications for this site in your browser settings.</p>}
          {permission === 'granted' && <p className="dd-status on"><span className="on-dot" />Desktop alerts are on</p>}

          {items.length === 0 ? (
            <div className="dd-empty">
              <span className="notify-icon tone-success" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <strong>You're all caught up</strong>
              <p>Outbids, wins and answers will show up here.</p>
            </div>
          ) : (
            <ul className="dd-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`dd-item ${n.read ? '' : 'unread'}`} onClick={() => go(n)}>
                    <NotifyIcon type={n.type} />
                    <span className="dd-text">
                      <span className="dd-title">{notifyMeta(n.type).title}</span>
                      <span className="dd-msg">{n.message}</span>
                      <span className="dd-time">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="dd-dot" aria-label="unread" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <button className="toast-body" onClick={() => go(toast)}>
            <NotifyIcon type={toast.type} />
            <span className="dd-text">
              <span className="dd-title">{notifyMeta(toast.type).title}</span>
              <span className="dd-msg">{toast.message}</span>
            </span>
          </button>
          <button className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
          <span className="toast-bar" />
        </div>
      )}
    </div>
  );
}
