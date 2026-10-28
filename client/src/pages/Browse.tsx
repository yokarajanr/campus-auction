import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { Auction, SavedSearch } from '../types';
import { CATEGORIES, CONDITION_LABELS, capitalize } from '../format';
import { AuctionCard } from '../components/AuctionCard';

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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    socket.on('auctions:changed', load);
    return () => { socket.off('auctions:changed', load); };
  }, [load]);

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

  return (
    <div>
      <section className="filters panel">
        <input className="search" placeholder="Search e.g. scientific calculator, cycle, DSA book..."
          value={filters.q} onChange={(e) => set('q', e.target.value)} />
        <div className="filter-row">
          <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
          </select>
          <select value={filters.condition} onChange={(e) => set('condition', e.target.value)}>
            <option value="">Any condition</option>
            {Object.entries(CONDITION_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <input type="number" min={0} placeholder="Min ₹" value={filters.minPrice} onChange={(e) => set('minPrice', e.target.value)} />
          <input type="number" min={0} placeholder="Max ₹" value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={filters.closingSoon} onChange={(e) => set('closingSoon', e.target.checked)} />
            Closing in 24h
          </label>
          <select value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="newest">Newest</option>
            <option value="closing_soon">Closing soonest</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
          </select>
          <button className="btn" onClick={() => { setFilters(EMPTY_FILTERS); setSearchText(''); setSaveMessage(''); }}>Clear</button>
          {canSave && <button className="btn primary" onClick={saveSearch}>Alert me about new matches</button>}
        </div>
        {saveMessage && <p className="notice">{saveMessage}</p>}
      </section>

      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading auctions...</p> : auctions.length === 0 ? (
        <p className="muted empty">No live auctions match. Try clearing the filters.</p>
      ) : (
        <div className="grid">
          {auctions.map((a) => <AuctionCard key={a.id} auction={a} />)}
        </div>
      )}
    </div>
  );
}
