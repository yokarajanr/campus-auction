import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ApiError, serverNow } from '../api';
import { useAuth } from '../auth';
import { socket } from '../socket';
import type { Auction, Question } from '../types';
import { formatTime } from '../format';

function AnswerForm({ question, onDone }: { question: Question; onDone: (qs: Question[]) => void }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onDone((await api<{ questions: Question[] }>(`/questions/${question.id}/answer`, { method: 'POST', json: { answer } })).questions);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="bid-row answer-form" onSubmit={submit}>
      <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer once, everyone sees it" maxLength={500} required />
      <button className="btn small primary">Answer</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function QnA({ auction }: { auction: Auction }) {
  const { user } = useAuth();
  const location = useLocation();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [text, setText] = useState('');
  const [similar, setSimilar] = useState<Question[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isSeller = user?.id === auction.sellerId;
  const open = auction.status === 'live' && auction.endsAt > serverNow();

  const load = useCallback(() => {
    api<{ questions: Question[] }>(`/auctions/${auction.id}/questions`).then((r) => setQuestions(r.questions)).catch(() => {});
  }, [auction.id]);

  useEffect(() => { load(); }, [load, user]);

  useEffect(() => {
    const onUpdate = (p: { auctionId: number; reason?: string }) => {
      if (p.auctionId === auction.id && p.reason === 'question') load();
    };
    socket.on('auction:update', onUpdate);
    return () => { socket.off('auction:update', onUpdate); };
  }, [auction.id, load]);

  useEffect(() => {
    if (text.trim().length < 8) return;
    const timer = setTimeout(() => {
      api<{ similar: Question[] }>(`/auctions/${auction.id}/questions/similar?text=${encodeURIComponent(text)}`)
        .then((r) => setSimilar(r.similar)).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [text, auction.id]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ questions: Question[] }>(`/auctions/${auction.id}/questions`, { method: 'POST', json: { text } });
      setQuestions(r.questions);
      setText('');
      setSimilar([]);
    } catch (err) {
      const dup = err instanceof ApiError ? (err.data?.duplicateOf as Question | undefined) : undefined;
      if (dup) setSimilar([dup]);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, json?: object) {
    try {
      setQuestions((await api<{ questions: Question[] }>(path, { method: 'POST', json })).questions);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const sameButton = (q: Question) => (user && !isSeller && !q.mine && q.answer == null ? (
    <button className="btn small" disabled={q.viewerVoted} onClick={() => act(`/questions/${q.id}/same`)}>
      {q.viewerVoted ? 'You asked this too' : 'I have the same question'}
    </button>
  ) : null);

  const showSimilar = text.trim().length >= 8 && similar.length > 0;

  return (
    <div className="panel">
      <h2>Questions before bidding ({questions.filter((q) => !q.hidden).length})</h2>

      {open && !isSeller && (user ? (
        <form className="form ask-form" onSubmit={ask}>
          <div className="bid-row">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
              placeholder="e.g. Do the brakes work? Is the display faded?" />
            <button className="btn primary" disabled={busy || text.trim().length < 8}>Ask</button>
          </div>
          {showSimilar && (
            <div className="similar">
              <p className="label">Already asked. Check before posting:</p>
              {similar.map((q) => (
                <div key={q.id} className="similar-item">
                  <p><strong>Q:</strong> {q.text}</p>
                  <p>{q.answer ? <><strong>A:</strong> {q.answer}</> : <span className="muted">Not answered yet.</span>}</p>
                  {sameButton(q)}
                </div>
              ))}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </form>
      ) : (
        <p className="muted"><Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>Log in</Link> to ask the seller a question.</p>
      ))}

      {questions.length === 0 ? <p className="muted">No questions yet.</p> : (
        <ul className="questions">
          {questions.map((q) => (
            <li key={q.id} className={q.hidden ? 'hidden-q' : ''}>
              <p><strong>Q:</strong> {q.text}</p>
              <p className="muted small">
                {q.askerName} · {formatTime(q.createdAt)}
                {q.sameCount > 0 && ` · ${q.sameCount} more student${q.sameCount === 1 ? '' : 's'} asked this`}
                {q.hidden && ' · hidden from others'}
              </p>
              {q.answer ? <p className="answer"><strong>Seller:</strong> {q.answer}</p>
                : isSeller ? <AnswerForm question={q} onDone={setQuestions} />
                : <p className="muted">Waiting for the seller to answer.</p>}
              <div className="actions">
                {sameButton(q)}
                {isSeller && (
                  <button className="btn small danger" onClick={() => act(`/questions/${q.id}/hide`, { hidden: !q.hidden })}>
                    {q.hidden ? 'Unhide' : 'Hide as spam'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
