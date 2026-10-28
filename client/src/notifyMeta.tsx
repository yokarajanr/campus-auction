type Tone = 'danger' | 'success' | 'warn' | 'primary' | 'accent' | 'muted';
type IconName = 'down' | 'up' | 'check' | 'alert' | 'search' | 'message' | 'clock';

const META: Record<string, { title: string; tone: Tone; icon: IconName }> = {
  outbid: { title: 'You were outbid', tone: 'danger', icon: 'down' },
  autobid_beaten: { title: 'Your auto-bid was beaten', tone: 'danger', icon: 'down' },
  new_bid: { title: 'New bid on your item', tone: 'primary', icon: 'up' },
  approve_needed: { title: 'Action needed: approve the sale', tone: 'warn', icon: 'alert' },
  provisional_win: { title: 'You are the provisional winner', tone: 'success', icon: 'check' },
  sale_approved: { title: 'Seller approved your win', tone: 'success', icon: 'check' },
  sale_completed: { title: 'Sale completed', tone: 'success', icon: 'check' },
  sale_rejected: { title: 'Seller rejected the price', tone: 'danger', icon: 'alert' },
  pickup_failed: { title: 'Pickup failed', tone: 'danger', icon: 'alert' },
  auction_cancelled: { title: 'Auction cancelled', tone: 'danger', icon: 'alert' },
  auction_lost: { title: 'Auction ended', tone: 'muted', icon: 'clock' },
  unsold: { title: 'Closed without bids', tone: 'muted', icon: 'clock' },
  saved_search_match: { title: 'New match for your saved search', tone: 'accent', icon: 'search' },
  question: { title: 'New question on your item', tone: 'primary', icon: 'message' },
  question_answered: { title: 'Your question was answered', tone: 'success', icon: 'message' },
};

export function notifyMeta(type: string) {
  return META[type] ?? { title: 'Campus Auction', tone: 'primary' as Tone, icon: 'alert' as IconName };
}

const PATHS: Record<IconName, string> = {
  down: 'M12 5v14M19 12l-7 7-7-7',
  up: 'M12 19V5M5 12l7-7 7 7',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 8v5M12 16.5h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5',
  message: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
};

export function NotifyIcon({ type, size = 18 }: { type: string; size?: number }) {
  const { tone, icon } = notifyMeta(type);
  return (
    <span className={`notify-icon tone-${tone}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[icon]} />
      </svg>
    </span>
  );
}

export function timeAgo(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return 'Yesterday';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
