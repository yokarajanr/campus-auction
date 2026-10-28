import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { AppNotification } from '../types';
import { formatTime } from '../format';

type Permission = NotificationPermission | 'unsupported';

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [permission, setPermission] = useState<Permission>(() => ('Notification' in window ? Notification.permission : 'unsupported'));

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
        const popup = new Notification('Campus Auction', { body: n.message, tag: `campus-auction-${n.id}` });
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!user) return null;

  function toggle() {
    setOpen((o) => !o);
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
    <div className="bell-wrap">
      <button className="bell" onClick={toggle} aria-label={`Notifications (${unread} unread)`}>
        Alerts{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          {permission === 'default' && (
            <button className="btn small primary enable" onClick={enableBrowserAlerts}>Enable browser pop-ups</button>
          )}
          {permission === 'denied' && <p className="muted small-note">Browser pop-ups are blocked. Allow them in your browser's site settings.</p>}
          {permission === 'granted' && <p className="muted small-note">Browser pop-ups are on. You'll get them when this tab is in the background.</p>}
          {items.length === 0 ? <p className="muted small-note">No alerts yet.</p> : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'} onClick={() => go(n)}>
                  <p>{n.message}</p>
                  <p className="muted">{formatTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {toast && (
        <div className="toast" onClick={() => go(toast)}>
          <strong>New alert</strong>
          <p>{toast.message}</p>
        </div>
      )}
    </div>
  );
}
