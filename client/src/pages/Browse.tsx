import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { Auction, SavedSearch } from '../types';
import { CATEGORIES, CONDITION_LABELS, capitalize, rupees } from '../format';
import { AuctionCard } from '../components/AuctionCard';
import { CategoryIcon } from '../components/CategoryIcon';
import { Countdown } from '../components/Countdown';
import { Photo } from '../components/Photo';

const EMPTY_FILTERS = { q: '', category: '', condition: '', minPrice: '', maxPrice: '', closingSoon: false, sort: 'newest' };

function filtersFromUrl(params: URLSearchParams) {
  return {
    ...EMPTY_FILTERS,
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    condition: params.get('condition') ?? '',
    maxPrice: params.get('maxPrice') ?? '',
  };
}

export function Browse() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [filters, setFilters] = useState(() => filtersFromUrl(params));
  const [searchText, setSearchText] = useState(() => params.get('q') ?? '');
  const [saveMessage, setSaveMessage] = useState('');
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [allLive, setAllLive] = useState<Auction[]>([]);
  const featured = allLive[0];
  const endingSoon = allLive.slice(1, 5);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearchText(filters.q), 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (searchText.trim()) params.set('q', searchText.trim());
    if (filters.category) params.set('category', filters.category);
    if (filters.condition) params.set('condition', filters.condition);
    if (filters.minPrice) params.set('minPrice', filters.minPrice);
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice);
    if (filters.closingSoon) params.set('closingSoon', '1');
    params.set('sort', filters.sort);
    return params.toString();
  }, [searchText, filters.category, filters.condition, filters.minPrice, filters.maxPrice, filters.closingSoon, filters.sort]);

  const load = useCallback(() => {
    api<{ auctions: Auction[] }>(`/auctions?${query}`)
      .then((r) => { setAuctions(r.auctions); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query]);

  const loadEndingSoon = useCallback(() => {
    api<{ auctions: Auction[] }>('/auctions?sort=closing_soon')
      .then((r) => setAllLive(r.auctions))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEndingSoon(); }, [loadEndingSoon]);

  useEffect(() => {
    const refresh = () => { load(); loadEndingSoon(); };
    socket.on('auctions:changed', refresh);
    return () => { socket.off('auctions:changed', refresh); };
  }, [load, loadEndingSoon]);

  const set = (key: keyof typeof EMPTY_FILTERS, value: string | boolean) => {
    setSaveMessage('');
    setFilters((f) => ({ ...f, [key]: value }));
  };

  async function saveSearch() {
    try {
      const r = await api<{ search: SavedSearch }>('/saved-searches', {
        method: 'POST',
        json: {
          keyword: filters.q,
          category: filters.category || null,
          condition: filters.condition || null,
          maxPrice: filters.maxPrice === '' ? null : Number(filters.maxPrice),
        },
      });
      setSaveMessage(`Saved "${r.search.label}". You'll get an alert when a new match is listed.`);
    } catch (e) {
      setSaveMessage((e as Error).message);
    }
  }

  const canSave = Boolean(user && (filters.q.trim() || filters.category));
  const anyFilter = Boolean(searchText.trim() || filters.category || filters.condition || filters.minPrice || filters.maxPrice || filters.closingSoon);

  const activeCount = [filters.category, filters.condition, filters.minPrice, filters.maxPrice, filters.closingSoon].filter(Boolean).length;
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearchText(''); setSaveMessage(''); };

  return (
    <div className="browse">
      <section className="hero-band">
        <div className="container hero-grid">
          <div className="hero">
            <p className="eyebrow"><span className="live-dot" />{allLive.length} auction{allLive.length === 1 ? '' : 's'} live now</p>
            <h1>Bid fairly on what seniors <mark>leave behind</mark>.</h1>
            <p className="hero-sub">Cycles, calculators and books from students leaving campus. Every bid is public, and every item has its own countdown.</p>
            <div className="hero-search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input className="search" placeholder="Search a scientific calculator, cycle, DSA book..."
                value={filters.q} onChange={(e) => set('q', e.target.value)} aria-label="Search auctions" />
            </div>
            <ul className="trust">
              <li><span className="check-icon">✓</span>Every bid is public</li>
              <li><span className="check-icon">✓</span>Late bids add 60 seconds</li>
              <li><span className="check-icon">✓</span>Pickup code on campus</li>
            </ul>
          </div>

          {featured && (
            <Link to={`/auctions/${featured.id}`} className="feature-card" aria-label={`Ending soonest: ${featured.title}`}>
              <div className="feature-back" aria-hidden="true" />
              <div className="feature-front">
                <div className="feature-photo">
                  <Photo src={featured.photos[0]} alt="" />
                  <span className="feature-flag">Ending soonest</span>
                </div>
                <div className="feature-body">
                  <p className="card-meta"><span className={`cat-dot cat-${featured.category}`} />{capitalize(featured.category)}</p>
                  <h3>{featured.title}</h3>
                  <div className="feature-stats">
                    <div>
                      <p className="label">{featured.bidCount ? 'Leading bid' : 'Starting at'}</p>
                      <p className="feature-price">{rupees(featured.currentPrice ?? featured.startPrice)}</p>
                    </div>
                    <div>
                      <p className="label">Ends in</p>
                      <p className="feature-time"><Countdown endsAt={featured.endsAt} /></p>
                    </div>
                  </div>
                  <span className="btn primary feature-cta">Place a bid</span>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Browse by category</h2>
            <p className="muted">Pick what you need for next semester</p>
          </div>
        </div>
        <div className="cat-tiles">
          {CATEGORIES.map((c) => {
            const count = allLive.filter((a) => a.category === c).length;
            return (
              <button key={c} className={`cat-tile cat-${c} ${filters.category === c ? 'active' : ''}`}
                onClick={() => { set('category', filters.category === c ? '' : c); document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }); }}>
                <span className="cat-icon"><CategoryIcon category={c} /></span>
                <span className="cat-name">{capitalize(c)}</span>
                <span className="cat-count">{count} live</span>
              </button>
            );
          })}
        </div>
      </section>

      {!anyFilter && endingSoon.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Ending soon</h2>
              <p className="muted">Last chance to bid on these</p>
            </div>
            <button className="link" onClick={() => set('sort', 'closing_soon')}>Sort all by ending time</button>
          </div>
          <div className="grid">
            {endingSoon.map((a) => <AuctionCard key={a.id} auction={a} />)}
          </div>
        </section>
      )}

      <section className="section" id="results">
        <div className="section-head">
          <div>
            <h2>{anyFilter ? 'Results' : 'All live auctions'}</h2>
            <p className="muted">{loading ? 'Loading...' : `${auctions.length} item${auctions.length === 1 ? '' : 's'}`}</p>
          </div>
          <div className="section-tools">
            <button className="btn filter-toggle" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              Filters{activeCount > 0 && <span className="count-pill">{activeCount}</span>}
            </button>
            <select className="sort" value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="closing_soon">Ending soonest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </div>
        </div>

        <div className="browse-layout">
          <aside className={`filters ${showFilters ? 'open' : ''}`}>
            <div className="filter-group">
              <p className="filter-title">Category</p>
              {['', ...CATEGORIES].map((c) => (
                <button key={c || 'all'} className={`filter-option ${filters.category === c ? 'active' : ''}`} onClick={() => set('category', c)}>
                  {c ? capitalize(c) : 'All categories'}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <label className="filter-title" htmlFor="f-condition">Condition</label>
              <select id="f-condition" value={filters.condition} onChange={(e) => set('condition', e.target.value)}>
                <option value="">Any condition</option>
                {Object.entries(CONDITION_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <p className="filter-title">Price (₹)</p>
              <div className="price-range">
                <input type="number" min={0} placeholder="Min" value={filters.minPrice} onChange={(e) => set('minPrice', e.target.value)} aria-label="Minimum price" />
                <span className="muted">to</span>
                <input type="number" min={0} placeholder="Max" value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} aria-label="Maximum price" />
              </div>
            </div>
            <label className="check filter-group">
              <input type="checkbox" checked={filters.closingSoon} onChange={(e) => set('closingSoon', e.target.checked)} />
              Ending in the next 24 hours
            </label>
            <div className="filter-actions">
              {canSave && <button className="btn primary" onClick={saveSearch}>Alert me about new matches</button>}
              {(anyFilter || filters.sort !== 'newest') && <button className="btn" onClick={clearAll}>Clear all</button>}
            </div>
            {saveMessage && <p className="notice">{saveMessage}</p>}
          </aside>

          <div className="results-area">
            {error && <p className="error">{error}</p>}
            {loading ? <p className="muted">Loading auctions...</p> : auctions.length === 0 ? (
              <div className="empty panel">
                <h3>No live auctions match</h3>
                <p className="muted">Try a different word or clear the filters. You can also save this search and get an alert when something is listed.</p>
                <div className="actions center">
                  <button className="btn" onClick={clearAll}>Clear filters</button>
                  {canSave && <button className="btn primary" onClick={saveSearch}>Alert me</button>}
                </div>
              </div>
            ) : (
              <div className="grid">
                {auctions.map((a) => <AuctionCard key={a.id} auction={a} />)}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="how-band">
        <div className="container">
          <p className="eyebrow light">How it works</p>
          <h2>From hostel room to new owner in three steps</h2>
          <ol className="steps">
            <li><span className="step-no">1</span><strong>List it</strong><p>Add photos, a starting price, a minimum step and when the auction ends.</p></li>
            <li><span className="step-no">2</span><strong>Bid in public</strong><p>Bid yourself, or set a maximum and let auto-bid raise one step at a time.</p></li>
            <li><span className="step-no">3</span><strong>Meet on campus</strong><p>The seller approves, the winner shows a 4-digit pickup code, and the sale is done.</p></li>
          </ol>
        </div>
      </section>
    </div>
  );
}
