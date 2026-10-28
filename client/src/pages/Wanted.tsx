import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Auction, SavedSearch } from '../types';
import { CATEGORIES, CONDITION_LABELS, capitalize } from '../format';
import { AuctionCard } from '../components/AuctionCard';
import { timeAgo } from '../notifyMeta';

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
  const [emailMe, setEmailMe] = useState(true);
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  async function openPreview(id: number) {
    try {
      setPreview((await api<{ html: string }>(`/saved-searches/emails/${id}`)).html);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview]);

  const load = () => {
    api<{ searches: SavedSearch[] }>('/saved-searches')
      .then((r) => setSearches(r.searches))
      .catch((e: Error) => setError(e.message));
    api<{ emails: SentEmail[] }>('/saved-searches/emails').then((r) => setEmails(r.emails)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  async function toggleEmail(s: SavedSearch) {
    try {
      const r = await api<{ searches: SavedSearch[] }>(`/saved-searches/${s.id}`, { method: 'PATCH', json: { emailAlerts: !s.emailAlerts } });
      setSearches(r.searches);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ search: SavedSearch; currentMatches: Auction[] }>('/saved-searches', {
        method: 'POST',
        json: { ...form, maxPrice: form.maxPrice === '' ? null : Number(form.maxPrice), emailAlerts: emailMe },
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
          <label className="check email-check">
            <input type="checkbox" checked={emailMe} onChange={(e) => setEmailMe(e.target.checked)} />
            Also email me when a match is listed
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
                <button className={`switch ${s.emailAlerts ? 'on' : ''}`} role="switch" aria-checked={s.emailAlerts}
                  onClick={() => toggleEmail(s)} title={s.emailAlerts ? 'Email alerts on' : 'Email alerts off'}>
                  <span className="switch-knob" />
                  <span className="switch-label">Email</span>
                </button>
                <button className="btn small danger" onClick={() => remove(s.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2>Recent email alerts</h2>
        {emails.length === 0 ? (
          <p className="muted">No emails yet. When a new listing matches a saved search with email on, the email shows up here.</p>
        ) : (
          <ul className="email-list">
            {emails.map((m) => (
              <li key={`${m.sentAt}-${m.auctionId}`}>
                <span className="notify-icon tone-primary" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                </span>
                <span className="dd-text">
                  <span className="dd-title">{m.subject}</span>
                  <span className="dd-time">
                    To {m.to} · {timeAgo(m.sentAt)} ·{' '}
                    <span className={`mail-status ${m.mode}`}>
                      {m.mode === 'smtp' ? 'Delivered' : m.mode === 'ethereal' ? 'Sent to test inbox' : 'Saved to outbox (mail server unreachable)'}
                    </span>
                  </span>
                </span>
                <button className="btn small" onClick={() => openPreview(m.id)}>Preview</button>
                {m.previewUrl && <a className="btn small" href={m.previewUrl} target="_blank" rel="noreferrer">Inbox</a>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" role="dialog" aria-label="Email preview" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Email preview</h3>
              <button className="toast-close" onClick={() => setPreview(null)} aria-label="Close">×</button>
            </div>
            <iframe title="Email preview" srcDoc={preview} sandbox="" className="email-frame" />
          </div>
        </div>
      )}
    </div>
  );
}

interface SentEmail {
  id: number;
  subject: string;
  to: string;
  auctionId: number;
  previewUrl: string | null;
  mode: 'smtp' | 'ethereal' | 'outbox';
  sentAt: number;
}
