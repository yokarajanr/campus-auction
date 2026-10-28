import { Link } from 'react-router-dom';
import type { Auction } from '../types';
import { CONDITION_LABELS, STATUS_LABELS, capitalize, rupees } from '../format';
import { Countdown } from './Countdown';
import { Photo } from './Photo';

export function AuctionCard({ auction, note }: { auction: Auction; note?: string }) {
  const live = auction.status === 'live';
  const price = auction.currentPrice ?? auction.startPrice;

  return (
    <Link to={`/auctions/${auction.id}`} className="card">
      <div className="card-photo">
        <Photo src={auction.photos[0]} alt={auction.title} lazy />
        {!live && <span className={`card-status status-${auction.status}`}>{STATUS_LABELS[auction.status]}</span>}
      </div>
      <div className="card-body">
        <p className="card-meta"><span className={`cat-dot cat-${auction.category}`} />{capitalize(auction.category)} · {CONDITION_LABELS[auction.condition] ?? auction.condition}</p>
        <h3 className="card-title">{auction.title}</h3>
        <div className="card-price">
          <span className="price">{rupees(price)}</span>
          <span className="muted">{auction.bidCount === 0 ? 'Starting price' : `${auction.bidCount} bid${auction.bidCount === 1 ? '' : 's'}`}</span>
        </div>
        {note && <p className="card-note">{note}</p>}
      </div>
      {live && (
        <div className="card-foot">
          <span className="muted">Ends in</span>
          <Countdown endsAt={auction.endsAt} />
        </div>
      )}
    </Link>
  );
}
