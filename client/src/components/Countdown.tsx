import { useNow } from '../hooks';
import { formatDuration } from '../format';

export function Countdown({ endsAt }: { endsAt: number }) {
  const now = useNow();
  const left = endsAt - now;
  if (left <= 0) return <span className="countdown closed">Closed</span>;
  const urgency = left < 60_000 ? 'urgent' : left < 3_600_000 ? 'soon' : '';
  return <span className={`countdown ${urgency}`}>{formatDuration(left)}</span>;
}
