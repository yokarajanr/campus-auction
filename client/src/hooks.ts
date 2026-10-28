import { useEffect, useState } from 'react';
import { serverNow } from './api';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
