import { Link } from 'react-router-dom';
import type { Auction } from '../types';
import { CONDITION_LABELS, STATUS_LABELS, capitalize, priceLine } from '../format';
import { Countdown } from './Countdown';

export function AuctionCard({ auction }: { auction: Auction }) {
  return (
    <Link to={`/auctions/${auction.id}`} className="card">
      <div className="card-photo">
        {auction.photos[0] ? <img src={auction.photos[0]} alt={auction.title} /> : <span>No photo</span>}
      </div>
      <div className="card-body">
        <div className="badges">
          <span className="badge">{capitalize(auction.category)}</span>
          <span className="badge">{CONDITION_LABELS[auction.condition] ?? auction.condition}</span>
          {auction.status !== 'live' && <span className={`badge status-${auction.status}`}>{STATUS_LABELS[auction.status]}</span>}
        </div>
        <h3>{auction.title}</h3>
        <p className="price">{priceLine(auction)}</p>
        {auction.status === 'live' && <p className="muted">Closes in <Countdown endsAt={auction.endsAt} /></p>}
      </div>
    </Link>
  );
}
