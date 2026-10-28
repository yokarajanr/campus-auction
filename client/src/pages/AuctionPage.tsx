import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, serverNow } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { AuctionDetail } from '../types';
import { CONDITION_LABELS, STATUS_LABELS, capitalize, formatTime, rupees } from '../format';
import { Countdown } from '../components/Countdown';

export function AuctionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [detail, setDetail] = useState<AuctionDetail | null>(null);
  const [error, setError] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);

  const load = useCallback(() => {
    api<AuctionDetail>(`/auctions/${id}`)
      .then((d) => { setDetail(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const join = () => socket.emit('auction:join', Number(id));
    join();
    socket.on('connect', join);
    socket.on('auction:update', load);
    return () => {
      socket.emit('auction:leave', Number(id));
      socket.off('connect', join);
      socket.off('auction:update', load);
    };
  }, [id, load]);

  if (error && !detail) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading...</p>;

  const { auction: a, bids, autoBids } = detail;
  const isSeller = user?.id === a.sellerId;
  const open = a.status === 'live' && a.endsAt > serverNow();

  async function cancel() {
    const reason = window.prompt('Why are you cancelling? (optional, shown publicly)');
    if (reason === null) return;
    try {
      setDetail(await api<AuctionDetail>(`/auctions/${a.id}/cancel`, { method: 'POST', json: { reason } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="auction">
      <div className="gallery panel">
        <div className="main-photo">
          {a.photos[photoIndex] ? <img src={a.photos[photoIndex]} alt={a.title} /> : <span>No photo</span>}
        </div>
        {a.photos.length > 1 && (
          <div className="thumbs">
            {a.photos.map((url, i) => (
              <button key={url} className={`thumb ${i === photoIndex ? 'active' : ''}`} onClick={() => setPhotoIndex(i)}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="info">
        <div className="panel">
          <div className="badges">
            <span className="badge">{capitalize(a.category)}</span>
            <span className="badge">{CONDITION_LABELS[a.condition] ?? a.condition}</span>
            <span className={`badge status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
          </div>
          <h1>{a.title}</h1>
          <p className="muted">Sold by {a.sellerName}</p>

          <div className="price-box">
            <div>
              <p className="label">{a.currentPrice == null ? 'Starting price' : 'Leading bid'}</p>
              <p className="big">{rupees(a.currentPrice ?? a.startPrice)}</p>
              {a.leaderName && <p className="muted">by {a.leaderName}</p>}
            </div>
            <div>
              <p className="label">{open ? 'Closes in' : 'Closed at'}</p>
              <p className="big">{open ? <Countdown endsAt={a.endsAt} /> : formatTime(a.endsAt)}</p>
              <p className="muted">{formatTime(a.endsAt)}</p>
            </div>
          </div>

          {open && (
            <p className="muted">Next bid must be at least <strong>{rupees(a.nextMinBid)}</strong> (increment {rupees(a.minIncrement)}).</p>
          )}
          {a.outcomeNote && <p className="notice">{a.outcomeNote}</p>}
          {error && <p className="error">{error}</p>}

          {isSeller && open && (
            <div className="actions">
              <Link className="btn" to={`/auctions/${a.id}/edit`}>Edit listing</Link>
              <button className="btn danger" onClick={cancel}>Cancel auction</button>
            </div>
          )}
        </div>

        {a.description && (
          <div className="panel">
            <h2>Description</h2>
            <p className="description">{a.description}</p>
          </div>
        )}

        {autoBids.length > 0 && (
          <div className="panel">
            <h2>Automatic bid maximums (public)</h2>
            <ul className="plain">
              {autoBids.map((ab) => <li key={ab.userId}>{ab.userName}: up to {rupees(ab.maxAmount)}</li>)}
            </ul>
          </div>
        )}

        <div className="panel">
          <h2>Bid history ({bids.length})</h2>
          {bids.length === 0 ? <p className="muted">No bids yet. Be the first!</p> : (
            <table className="bids">
              <thead><tr><th>Bidder</th><th>Amount</th><th>Time</th></tr></thead>
              <tbody>
                {bids.map((b, i) => (
                  <tr key={b.id} className={i === 0 ? 'leading' : ''}>
                    <td>{b.bidderName}{b.isAuto && <span className="tag">auto</span>}</td>
                    <td>{rupees(b.amount)}</td>
                    <td>{formatTime(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
