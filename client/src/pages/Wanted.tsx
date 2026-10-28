import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Auction, SavedSearch } from '../types';
import { CATEGORIES, CONDITION_LABELS, capitalize } from '../format';
import { AuctionCard } from '../components/AuctionCard';

export function browseLink(s: Pick<SavedSearch, 'keyword' | 'category' | 'condition' | 'maxPrice'>) {
  const p = new URLSearchParams();
  if (s.keyword) p.set('q', s.keyword);
  if (s.category) p.set('category', s.category);
  if (s.condition) p.set('condition', s.condition);
  if (s.maxPrice != null) p.set('maxPrice', String(s.maxPrice));
  return `/?${p.toString()}`;
}

export function Wanted() {
  const [searches, setSearches] = useState<SavedSearch[] | null>(null);
  const [form, setForm] = useState({ keyword: '', category: '', condition: '', maxPrice: '' });
  const [justSaved, setJustSaved] = useState<{ search: SavedSearch; currentMatches: Auction[] } | null>(null);
  const [error, setError] = useState('');

  const load = () => api<{ searches: SavedSearch[] }>('/saved-searches')
    .then((r) => setSearches(r.searches))
    .catch((e: Error) => setError(e.message));

  useEffect(() => { load(); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ search: SavedSearch; currentMatches: Auction[] }>('/saved-searches', {
        method: 'POST',
        json: { ...form, maxPrice: form.maxPrice === '' ? null : Number(form.maxPrice) },
      });
      setJustSaved(r);
      setForm({ keyword: '', category: '', condition: '', maxPrice: '' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    await api(`/saved-searches/${id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    load();
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="narrow-wide">
      <div className="panel">
        <h1>Never miss what you need</h1>
        <p className="muted">Tell us what you're looking for. When a matching item is listed, you get an alert, even if you're offline, in class or asleep.</p>
        <form className="form" onSubmit={save}>
          <label>What are you looking for?
            <input value={form.keyword} onChange={set('keyword')} placeholder="e.g. scientific calculator" maxLength={80} />
          </label>
          <div className="row">
            <label>Category
              <select value={form.category} onChange={set('category')}>
                <option value="">Any category</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </label>
            <label>Condition
              <select value={form.condition} onChange={set('condition')}>
                <option value="">Any condition</option>
                {Object.entries(CONDITION_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          </div>
          <label>Up to (₹)
            <input type="number" min={0} value={form.maxPrice} onChange={set('maxPrice')} placeholder="e.g. 400" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary">Alert me</button>
        </form>
      </div>

      {justSaved && (
        <div className="panel">
          <h2>Saved: "{justSaved.search.label}"</h2>
          {justSaved.currentMatches.length === 0
            ? <p className="muted">Nothing matches yet. We'll alert you as soon as something is listed.</p>
            : (
              <>
                <p className="muted">Already listed right now:</p>
                <div className="grid">{justSaved.currentMatches.slice(0, 6).map((a) => <AuctionCard key={a.id} auction={a} />)}</div>
              </>
            )}
        </div>
      )}

      <div className="panel">
        <h2>Your saved searches</h2>
        {!searches ? <p className="muted">Loading...</p> : searches.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="saved-list">
            {searches.map((s) => (
              <li key={s.id}>
                <span className="saved-label">{s.label}</span>
                <Link to={browseLink(s)} className="muted">{s.liveMatches} live match{s.liveMatches === 1 ? '' : 'es'}</Link>
                <button className="btn small danger" onClick={() => remove(s.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
