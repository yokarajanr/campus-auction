import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, serverNow } from '../api';
import { useAuth } from '../auth';
import type { Auction, AuctionDetail } from '../types';
import { CATEGORIES, CONDITION_LABELS, capitalize, toLocalInput } from '../format';
import { prepareImage } from '../images';

const MAX_PHOTOS = 5;

interface FormValues {
  title: string;
  category: string;
  condition: string;
  description: string;
  startPrice: string;
  minIncrement: string;
  endsAt: string;
}

function valuesFrom(a: Auction): FormValues {
  return {
    title: a.title,
    category: a.category,
    condition: a.condition,
    description: a.description,
    startPrice: String(a.startPrice),
    minIncrement: String(a.minIncrement),
    endsAt: toLocalInput(a.endsAt),
  };
}

const DEFAULTS: FormValues = {
  title: '', category: 'calculator', condition: 'good', description: '',
  startPrice: '', minIncrement: '20', endsAt: toLocalInput(Date.now() + 24 * 3600 * 1000),
};

export function Sell() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const relistId = editing ? null : params.get('relist');
  const { user } = useAuth();
  const navigate = useNavigate();

  const [original, setOriginal] = useState<Auction | null>(null);
  const [relistSource, setRelistSource] = useState<Auction | null>(null);
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [keepPhotos, setKeepPhotos] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<AuctionDetail>(`/auctions/${id}`)
      .then(({ auction }) => {
        setOriginal(auction);
        setValues(valuesFrom(auction));
        setKeepPhotos(auction.photos);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!relistId) return;
    api<AuctionDetail>(`/auctions/${relistId}`)
      .then(({ auction }) => {
        setRelistSource(auction);
        setValues({ ...valuesFrom(auction), endsAt: toLocalInput(serverNow() + 24 * 3_600_000) });
        setKeepPhotos(auction.photos);
      })
      .catch((e: Error) => setError(e.message));
  }, [relistId]);

  const locked = editing && (original?.bidCount ?? 0) > 0;
  const photoCount = keepPhotos.length + newPhotos.length;
  const set = (key: keyof FormValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const closeIn = (ms: number) => setValues((v) => ({ ...v, endsAt: toLocalInput(serverNow() + ms) }));

  async function addPhotos(picked: File[]) {
    if (picked.length === 0) return;
    setError('');
    setPreparing(true);
    const room = MAX_PHOTOS - keepPhotos.length - newPhotos.length;
    const ready: File[] = [];
    const problems: string[] = [];
    for (const file of picked.slice(0, Math.max(0, room))) {
      try {
        ready.push(await prepareImage(file));
      } catch (err) {
        problems.push((err as Error).message);
      }
    }
    if (picked.length > room) problems.push(`Only ${MAX_PHOTOS} photos are allowed, so ${picked.length - Math.max(0, room)} were skipped.`);
    setNewPhotos((current) => [...current, ...ready].slice(0, MAX_PHOTOS - keepPhotos.length));
    if (problems.length) setError(problems.join(' '));
    setPreparing(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (photoCount === 0) return setError('Add at least one photo');

    const form = new FormData();
    const before = original ? valuesFrom(original) : null;
    for (const key of ['title', 'category', 'condition', 'description', 'startPrice', 'minIncrement'] as const) {
      if (!before || values[key] !== before[key]) form.append(key, values[key]);
    }
    if (!before || values.endsAt !== before.endsAt) form.append('endsAt', new Date(values.endsAt).toISOString());
    if (original && keepPhotos.length !== original.photos.length) form.append('keepPhotos', JSON.stringify(keepPhotos));
    if (relistSource) {
      form.append('relistFrom', String(relistSource.id));
      form.append('keepPhotos', JSON.stringify(keepPhotos));
    }
    newPhotos.forEach((file) => form.append('photos', file));

    setBusy(true);
    try {
      const r = await api<AuctionDetail>(editing ? `/auctions/${id}` : '/auctions', { method: editing ? 'PATCH' : 'POST', form });
      navigate(`/auctions/${r.auction.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing && original && original.sellerId !== user?.id) return <p className="error">Only the seller can edit this listing.</p>;
  if (relistSource && relistSource.sellerId !== user?.id) return <p className="error">Only the seller can list this item again.</p>;
  if (editing && !original) return error ? <p className="error">{error}</p> : <p className="muted">Loading...</p>;

  return (
    <div className="narrow panel">
      <h1>{editing ? 'Edit listing' : relistSource ? 'List this item again' : 'Sell an item'}</h1>
      {relistSource && (
        <p className="notice">Copied from your earlier listing. Pick a new closing time, change anything you like, then publish. The earlier auction stays in your history.</p>
      )}
      {locked && <p className="notice">Someone has already bid, so only the description can change and photos can only be added. This keeps the auction fair.</p>}
      <form onSubmit={submit} className="form">
        <label>Title
          <input value={values.title} onChange={set('title')} required minLength={3} maxLength={80} disabled={locked}
            placeholder="e.g. Casio fx-991EX scientific calculator" />
        </label>
        <div className="row">
          <label>Category
            <select value={values.category} onChange={set('category')} disabled={locked}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{capitalize(c)}</option>)}
            </select>
          </label>
          <label>Condition
            <select value={values.condition} onChange={set('condition')} disabled={locked}>
              {Object.entries(CONDITION_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
        </div>
        <label>Description
          <textarea value={values.description} onChange={set('description')} rows={4} maxLength={2000}
            placeholder="Brakes, display, marks, what's included..." />
        </label>
        <div className="row">
          <label>Starting price (₹)
            <input type="number" min={0} value={values.startPrice} onChange={set('startPrice')} required disabled={locked} />
          </label>
          <label>Minimum bid increment (₹)
            <input type="number" min={1} value={values.minIncrement} onChange={set('minIncrement')} required disabled={locked} />
          </label>
        </div>
        <label>Closing date and time
          <input type="datetime-local" value={values.endsAt} onChange={set('endsAt')} required disabled={locked} />
        </label>
        {!locked && (
          <div className="presets">
            <span className="muted">Quick:</span>
            <button type="button" className="btn small" onClick={() => closeIn(3 * 60_000)}>In 3 min</button>
            <button type="button" className="btn small" onClick={() => closeIn(3_600_000)}>In 1 hour</button>
            <button type="button" className="btn small" onClick={() => closeIn(24 * 3_600_000)}>In 1 day</button>
            <button type="button" className="btn small" onClick={() => closeIn(3 * 24 * 3_600_000)}>In 3 days</button>
          </div>
        )}

        <div>
          <p className="label">Photos ({photoCount}/{MAX_PHOTOS})</p>
          <div className="thumbs">
            {keepPhotos.map((url) => (
              <div key={url} className="thumb">
                <img src={url} alt="" />
                {!locked && <button type="button" onClick={() => setKeepPhotos((p) => p.filter((x) => x !== url))}>Remove</button>}
              </div>
            ))}
            {newPhotos.map((file, i) => (
              <div key={`${file.name}-${i}`} className="thumb">
                <img src={URL.createObjectURL(file)} alt="" />
                <button type="button" onClick={() => setNewPhotos((p) => p.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          {photoCount < MAX_PHOTOS && (
            <label className="photo-drop">
              <input type="file" accept="image/*,.heic,.heif" multiple disabled={preparing}
                onChange={(e) => { const chosen = Array.from(e.target.files ?? []); e.target.value = ''; addPhotos(chosen); }} />
              <span className="photo-drop-icon" aria-hidden="true">+</span>
              <span>
                <strong>{preparing ? 'Preparing photos...' : 'Add photos'}</strong>
                <span className="muted"> · JPG, PNG, WEBP and more. Large photos are resized automatically.</span>
              </span>
            </label>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || preparing}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Publish auction'}</button>
      </form>
    </div>
  );
}
