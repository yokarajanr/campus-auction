import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Auction, AuctionDetail } from '../types';
import { rupees } from '../format';

interface Props {
  auction: Auction;
  onPlaced: (detail: AuctionDetail & { extended: boolean }) => void;
}

export function BidBox({ auction, onPlaced }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <div className="bid-box">
        <Link className="btn primary" to={`/login?next=${encodeURIComponent(location.pathname)}`}>Log in to bid</Link>
      </div>
    );
  }
  if (user.id === auction.sellerId) return <p className="muted">This is your listing, so you can't bid on it.</p>;
  if (user.id === auction.leaderId) return <p className="leading-note">You are the leading bidder.</p>;

  const value = amount === '' || Number(amount) < auction.nextMinBid ? String(auction.nextMinBid) : amount;
  const quick = [auction.nextMinBid, auction.nextMinBid + auction.minIncrement, auction.nextMinBid + 4 * auction.minIncrement];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const detail = await api<AuctionDetail & { extended: boolean }>(`/auctions/${auction.id}/bids`, {
        method: 'POST',
        json: { amount: Number(value) },
      });
      setAmount('');
      onPlaced(detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="bid-box" onSubmit={submit}>
      <div className="bid-row">
        <span className="rupee">₹</span>
        <input type="number" min={auction.nextMinBid} step={1} value={value} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn primary" disabled={busy}>{busy ? 'Placing...' : 'Place bid'}</button>
      </div>
      <div className="presets">
        {quick.map((q) => (
          <button key={q} type="button" className="btn small" onClick={() => setAmount(String(q))}>{rupees(q)}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
