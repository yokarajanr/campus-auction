import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { AssistantReply, Proposal } from '../types';
import { rupees } from '../format';
import { Countdown } from '../components/Countdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  reply?: AssistantReply;
}

const EXAMPLES = [
  'Find me a cycle under ₹2,000',
  'Any scientific calculator under ₹400?',
  'Bid for me on a cycle up to ₹1,800',
  'Alert me about DSA books under ₹200',
];

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [state, setState] = useState<'pending' | 'busy' | 'done' | 'dismissed'>('pending');
  const [message, setMessage] = useState('');

  async function confirm() {
    setState('busy');
    try {
      if (proposal.type === 'auto_bid') {
        await api(`/auctions/${proposal.auctionId}/auto-bid`, { method: 'PUT', json: { maxAmount: proposal.maxAmount } });
        setMessage(`Done. Automatic bidding is on for "${proposal.title}", up to ${rupees(proposal.maxAmount)}.`);
      } else {
        await api('/saved-searches', { method: 'POST', json: { keyword: proposal.keyword, category: proposal.category, maxPrice: proposal.maxPrice } });
        setMessage(`Saved. You'll get an alert for "${proposal.label}".`);
      }
      setState('done');
    } catch (e) {
      setMessage((e as Error).message);
      setState('pending');
    }
  }

  if (state === 'dismissed') return <p className="muted">Okay, nothing was done.</p>;

  return (
    <div className="proposal">
      {proposal.type === 'auto_bid' ? (
        <p>
          Set an <strong>automatic bid</strong> on <Link to={`/auctions/${proposal.auctionId}`}>{proposal.title}</Link> with a maximum of{' '}
          <strong>{rupees(proposal.maxAmount)}</strong>? It's at {rupees(proposal.currentPrice)} now. The app bids only as much as needed and never above your maximum.
        </p>
      ) : (
        <p>Save a search for <strong>"{proposal.label}"</strong> and alert me when a new match is listed?</p>
      )}
      {state === 'done' ? <p className="leading-note">{message}</p> : (
        <div className="actions">
          <button className="btn primary" disabled={state === 'busy'} onClick={confirm}>Confirm</button>
          <button className="btn" disabled={state === 'busy'} onClick={() => setState('dismissed')}>No thanks</button>
        </div>
      )}
      {state !== 'done' && message && <p className="error">{message}</p>}
    </div>
  );
}

export function Assistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'gemini' | 'rules' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ mode: 'gemini' | 'rules' }>('/assistant/status').then((r) => setMode(r.mode)).catch(() => {});
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user', text: text.trim() }];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const reply = await api<AssistantReply>('/assistant/chat', {
        method: 'POST',
        json: { messages: history.map((m) => ({ role: m.role, text: m.text })) },
      });
      setMode(reply.mode);
      setMessages((m) => [...m, { role: 'assistant', text: reply.reply, reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, something went wrong: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="narrow-wide">
      <div className="panel">
        <div className="page-head">
          <h1>Assistant</h1>
          {mode && <span className={`badge ${mode === 'gemini' ? 'status-live' : ''}`}>{mode === 'gemini' ? 'AI: Gemini' : 'Offline mode'}</span>}
        </div>
        <p className="muted">
          Say what you need and get a straight answer. I can also prepare an automatic bid or an alert for you, but nothing happens until you press Confirm,
          and I never go above the limit you give me.
        </p>
      </div>

      <div className="panel chat">
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((ex) => <button key={ex} className="btn small" onClick={() => send(ex)}>{ex}</button>)}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p className="bubble">{m.text}</p>
            {m.reply?.fallbackReason && <p className="muted small">{m.reply.fallbackReason}</p>}
            {m.reply?.results && m.reply.results.length > 0 && (
              <ul className="results">
                {m.reply.results.map((a) => (
                  <li key={a.id}>
                    <Link to={`/auctions/${a.id}`}>{a.title}</Link>
                    <span>{rupees(a.currentPrice ?? a.startPrice)}</span>
                    <span className="muted"><Countdown endsAt={a.endsAt} /></span>
                  </li>
                ))}
              </ul>
            )}
            {m.reply?.proposals.map((p, j) => <ProposalCard key={j} proposal={p} />)}
          </div>
        ))}
        {busy && <p className="muted">Thinking...</p>}
        <div ref={bottom} />
        <form className="bid-row chat-input" onSubmit={submit}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder='e.g. "find me a cycle under ₹2,000"' maxLength={500} />
          <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}
