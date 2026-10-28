import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Auction } from '../types';
import { AuctionCard } from '../components/AuctionCard';

export function MyListings() {
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ auctions: Auction[] }>('/auctions/mine')
      .then((r) => setAuctions(r.auctions))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!auctions) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="page-head">
        <h1>My listings</h1>
        <Link className="btn primary" to="/sell">+ Sell an item</Link>
      </div>
      {auctions.length === 0 ? <p className="muted empty">You haven't listed anything yet.</p> : (
        <div className="grid">
          {auctions.map((a) => <AuctionCard key={a.id} auction={a} />)}
        </div>
      )}
    </div>
  );
}
