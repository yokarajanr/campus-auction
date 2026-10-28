import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Auction } from '../types';
import { AuctionCard } from '../components/AuctionCard';

function myStanding(a: Auction, me: number) {
  if (a.status === 'live') return a.leaderId === me ? 'You are leading' : 'You were outbid';
  if (a.winnerId !== me) return a.status === 'cancelled' ? 'Cancelled by seller' : "You didn't win";
  switch (a.status) {
    case 'awaiting_seller': return 'You won. Waiting for seller approval';
    case 'reserved': return 'Reserved for you. Pickup pending';
    case 'completed': return 'You bought this';
    case 'rejected': return 'Seller rejected the price';
    case 'failed_pickup': return 'Pickup failed';
    default: return '';
  }
}

export function MyBids() {
  const { user } = useAuth();
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ auctions: Auction[] }>('/auctions/bidding')
      .then((r) => setAuctions(r.auctions))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!auctions || !user) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="page-head"><h1>My bids</h1></div>
      {auctions.length === 0 ? <p className="muted empty">You haven't bid on anything yet.</p> : (
        <div className="grid">
          {auctions.map((a) => <AuctionCard key={a.id} auction={a} note={myStanding(a, user.id)} />)}
        </div>
      )}
    </div>
  );
}
