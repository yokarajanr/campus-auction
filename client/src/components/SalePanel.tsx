import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { AuctionDetail } from '../types';
import { rupees } from '../format';

interface Props {
  detail: AuctionDetail;
  onChange: (detail: AuctionDetail) => void;
}

export function SalePanel({ detail, onChange }: Props) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const a = detail.auction;
  const isSeller = user?.id === a.sellerId;
  const isWinner = user?.id != null && user.id === a.winnerId;
  const price = rupees(a.currentPrice ?? 0);

  async function act(action: string, body: object = {}) {
    setError('');
    setBusy(true);
    try {
      onChange(await api<AuctionDetail>(`/auctions/${a.id}/${action}`, { method: 'POST', json: body }));
      setCode('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function withReason(action: string, question: string) {
    const reason = window.prompt(question);
    if (reason !== null) act(action, { reason });
  }

  function handover(e: FormEvent) {
    e.preventDefault();
    act('handover', { code });
  }

  const failedPickup = (
    <button className="btn danger small" disabled={busy}
      onClick={() => withReason('failed-pickup', 'What went wrong with the pickup? (shown publicly)')}>
      Report failed pickup
    </button>
  );

  let content = null;
  if (a.status === 'awaiting_seller') {
    content = isSeller ? (
      <>
        <h2>Your decision</h2>
        <p>The highest bid is <strong>{price}</strong> by <strong>{a.winnerName}</strong>. Do you accept this price?</p>
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => act('approve')}>Approve and reserve</button>
          <button className="btn danger" disabled={busy} onClick={() => withReason('reject', 'Why are you rejecting? (optional, shown publicly)')}>Reject</button>
        </div>
      </>
    ) : isWinner ? (
      <p className="leading-note">You are the provisional winner at {price}. Waiting for the seller to approve.</p>
    ) : (
      <p className="muted">Waiting for the seller to accept or reject the winning bid of {price}.</p>
    );
  } else if (a.status === 'reserved') {
    content = isWinner ? (
      <>
        <h2>Reserved for you</h2>
        <p>Meet the seller on campus and show this pickup code:</p>
        <p className="pickup-code">{detail.pickupCode}</p>
        <div className="actions">{failedPickup}</div>
      </>
    ) : isSeller ? (
      <>
        <h2>Campus handover</h2>
        <p>Reserved for <strong>{a.winnerName}</strong> at {price}. Ask the buyer for their 4-digit pickup code when you meet.</p>
        <form className="bid-row" onSubmit={handover}>
          <input inputMode="numeric" maxLength={4} placeholder="4-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn primary" disabled={busy || code.length !== 4}>Confirm handover</button>
        </form>
        <div className="actions">{failedPickup}</div>
      </>
    ) : (
      <p className="muted">Reserved for {a.winnerName}. Handover pending.</p>
    );
  } else if (isSeller && ['unsold', 'rejected', 'failed_pickup', 'cancelled'].includes(a.status)) {
    content = <Link className="btn" to="/sell">List an item again</Link>;
  }

  if (!content) return null;
  return (
    <div className="sale-panel">
      {content}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
