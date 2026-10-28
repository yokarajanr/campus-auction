import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, serverNow } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { AuctionDetail } from '../types';
import { CONDITION_LABELS, STATUS_LABELS, capitalize, formatTime, rupees } from '../format';
import { Countdown } from '../components/Countdown';
import { BidBox } from '../components/BidBox';
import { SalePanel } from '../components/SalePanel';
import { AutoBidBox } from '../components/AutoBidBox';
import { QnA } from '../components/QnA';
import { useNow } from '../hooks';

export function AuctionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [detail, setDetail] = useState<AuctionDetail | null>(null);
  const [error, setError] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [flash, setFlash] = useState('');
  const now = useNow();

  const showExtended = useCallback(() => {
    setFlash('Last-minute bid! Closing time was extended to 60 seconds after that bid.');
    setTimeout(() => setFlash(''), 8000);
  }, []);

  const load = useCallback(() => {
    api<AuctionDetail>(`/auctions/${id}`)
      .then((d) => { setDetail(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const join = () => socket.emit('auction:join', Number(id));
    const onUpdate = (payload: { auctionId: number; extended?: boolean }) => {
      if (payload.auctionId !== Number(id)) return;
      if (payload.extended) showExtended();
      load();
    };
    join();
    socket.on('connect', join);
    socket.on('auction:update', onUpdate);
    return () => {
      socket.emit('auction:leave', Number(id));
      socket.off('connect', join);
      socket.off('auction:update', onUpdate);
    };
  }, [id, load, showExtended]);

  const endsAt = detail?.auction.endsAt;
  const status = detail?.auction.status;
  useEffect(() => {
    if (status !== 'live' || endsAt == null) return;
    const timer = setTimeout(load, Math.max(0, endsAt - serverNow()) + 1500);
    return () => clearTimeout(timer);
  }, [endsAt, status, load]);

  if (error && !detail) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading...</p>;

  const { auction: a, bids, autoBids } = detail;
  const isSeller = user?.id === a.sellerId;
  const open = a.status === 'live' && a.endsAt > now;
  const closing = a.status === 'live' && !open;

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
    <>
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/">Browse</Link>
      <span aria-hidden="true">/</span>
      <Link to={`/?category=${a.category}`}>{capitalize(a.category)}</Link>
      <span aria-hidden="true">/</span>
      <span className="crumb-current">{a.title}</span>
    </nav>
    <div className="auction">
      <div className="auction-side">
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

        {a.description && (
          <div className="panel description-panel">
            <h2>Description</h2>
            <p className="description">{a.description}</p>
          </div>
        )}

        <div className="qna-panel"><QnA auction={a} /></div>
      </div>

      <div className="info">
        <div className="panel main-panel">
          <div className="badges">
            <span className="badge">{capitalize(a.category)}</span>
            <span className="badge">{CONDITION_LABELS[a.condition] ?? a.condition}</span>
            <span className={`badge status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
          </div>
          <h1>{a.title}</h1>
          <p className="muted">Sold by {a.sellerName}</p>

          <div className="price-box">
            <div>
              <p className="label">{a.currentPrice == null ? 'Starting price' : open ? 'Leading bid' : 'Winning bid'}</p>
              <p className="big lead-price">{rupees(a.currentPrice ?? a.startPrice)}</p>
              {a.leaderName ? (
                <span className={`leader-chip ${a.leaderId === user?.id ? 'me' : ''}`}>
                  <span className="mini-avatar">{initialsOf(a.leaderName)}</span>
                  {a.leaderId === user?.id ? 'You are leading' : <><strong>{a.leaderName}</strong>&nbsp;{open ? 'is leading' : 'won'}</>}
                </span>
              ) : (
                <span className="leader-chip empty">No bids yet. Be the first!</span>
              )}
            </div>
            <div>
              <p className="label">{open ? 'Closes in' : 'Closed at'}</p>
              <p className="big">{open ? <Countdown endsAt={a.endsAt} /> : formatTime(a.endsAt)}</p>
              <p className="muted">{formatTime(a.endsAt)}</p>
            </div>
          </div>

          {flash && <p className="flash">{flash}</p>}
          {open && (
            <>
              <p className="muted">Next bid must be at least <strong>{rupees(a.nextMinBid)}</strong> (increment {rupees(a.minIncrement)}).</p>
              <BidBox auction={a} onPlaced={(d) => { setDetail(d); if (d.extended) showExtended(); }} />
              <AutoBidBox detail={detail} onChange={(d) => { setDetail(d); if (d.extended) showExtended(); }} />
            </>
          )}
          {closing && <p className="muted">Bidding has ended. Finalising the result...</p>}
          {a.outcomeNote && <p className="notice">{a.outcomeNote}</p>}
          <SalePanel detail={detail} onChange={setDetail} />
          {error && <p className="error">{error}</p>}

          {isSeller && open && (
            <div className="actions">
              <Link className="btn" to={`/auctions/${a.id}/edit`}>Edit listing</Link>
              <button className="btn danger" onClick={cancel}>Cancel auction</button>
            </div>
          )}
        </div>

        {autoBids.length > 0 && (
          <div className="panel maxima-panel">
            <h2>Automatic bid maximums (public)</h2>
            <ul className="plain">
              {autoBids.map((ab) => (
                <li key={ab.userId}>
                  {ab.userName}: up to {rupees(ab.maxAmount)}
                  {ab.maxAmount < (a.currentPrice ?? 0) || (ab.userId !== a.leaderId && ab.maxAmount < a.nextMinBid)
                    ? <span className="tag muted-tag">exceeded</span>
                    : ab.userId === a.leaderId ? <span className="tag">leading</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="panel history-panel">
          <h2>Bid history ({bids.length})</h2>
          {bids.length === 0 ? <p className="muted">No bids yet. Be the first!</p> : (
            <table className="bids">
              <thead><tr><th>Bidder</th><th>Amount</th><th>Time</th></tr></thead>
              <tbody>
                {bids.map((b, i) => (
                  <tr key={b.id} className={i === 0 ? 'leading' : ''}>
                    <td>
                      <span className="bidder">
                        <span className="mini-avatar">{initialsOf(b.bidderName)}</span>
                        <span>{b.bidderName}{b.bidderId === user?.id && <span className="you"> (you)</span>}</span>
                        {b.isAuto && <span className="tag">auto</span>}
                        {i === 0 && <span className="tag lead-tag">{a.status === 'live' ? 'leading' : 'top bid'}</span>}
                      </span>
                    </td>
                    <td className="amount">{rupees(b.amount)}</td>
                    <td className="muted">{formatTime(b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function initialsOf(name: string) {
  return name.replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /^[a-z]/i.test(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
