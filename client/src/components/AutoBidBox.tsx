import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { AuctionDetail } from '../types';
import { rupees } from '../format';

interface Props {
  detail: AuctionDetail;
  onChange: (detail: AuctionDetail & { extended: boolean }) => void;
}

export function AutoBidBox({ detail, onChange }: Props) {
  const { user } = useAuth();
  const [max, setMax] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const a = detail.auction;
  if (!user || user.id === a.sellerId) return null;
  const mine = detail.autoBids.find((ab) => ab.userId === user.id);
  const floor = a.leaderId === user.id && a.currentPrice != null ? a.currentPrice : a.nextMinBid;

  async function send(method: 'PUT' | 'DELETE', body?: object) {
    setError('');
    setBusy(true);
    try {
      onChange(await api<AuctionDetail & { extended: boolean }>(`/auctions/${a.id}/auto-bid`, { method, json: body }));
      setMax('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send('PUT', { maxAmount: Number(max) });
  }

  return (
    <div className="auto-box">
      <h3>Automatic bidding</h3>
      {mine ? (
        <p>
          Your maximum is <strong>{rupees(mine.maxAmount)}</strong>. The app bids for you only as much as needed to keep you in the lead.{' '}
          <button className="link" disabled={busy} onClick={() => send('DELETE')}>Turn off</button>
        </p>
      ) : (
        <p className="muted">Set the most you're willing to pay. The app bids for you one step at a time, never above your maximum. Maximums are public.</p>
      )}
      <form className="bid-row" onSubmit={submit}>
        <span className="rupee">₹</span>
        <input type="number" min={floor} step={1} placeholder={`At least ${floor}`} value={max} onChange={(e) => setMax(e.target.value)} required />
        <button className="btn" disabled={busy}>{mine ? 'Update maximum' : 'Set maximum'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
