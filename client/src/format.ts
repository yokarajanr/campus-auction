import type { Auction, AuctionStatus } from './types';

export const CATEGORIES = ['cycle', 'calculator', 'books', 'electronics', 'other'];

export const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export const STATUS_LABELS: Record<AuctionStatus, string> = {
  live: 'Live',
  cancelled: 'Cancelled',
  unsold: 'Unsold',
  awaiting_seller: 'Awaiting seller decision',
  rejected: 'Rejected by seller',
  reserved: 'Reserved for winner',
  completed: 'Sold',
  failed_pickup: 'Pickup failed',
};

export function rupees(amount: number) {
  return `\u20B9${amount.toLocaleString('en-IN')}`;
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

export function formatTime(ms: number) {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function priceLine(a: Auction) {
  return a.currentPrice == null
    ? `Starts at ${rupees(a.startPrice)}`
    : `${rupees(a.currentPrice)} \u00B7 ${a.bidCount} bid${a.bidCount === 1 ? '' : 's'}`;
}

// datetime-local inputs work in local time without seconds.
export function toLocalInput(ms: number) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
