import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  cycle: (
    <>
      <circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17 9 9h6l3.5 8M9 9 12 17h3M14 6h3" />
    </>
  ),
  calculator: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2" />
      <path d="M8 6.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5" />
    </>
  ),
  books: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 21.5h13" />
      <path d="M9 7h6" />
    </>
  ),
  electronics: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="2.5" y="14" width="4.5" height="7" rx="1.5" /><rect x="17" y="14" width="4.5" height="7" rx="1.5" />
    </>
  ),
  other: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
};

export function CategoryIcon({ category, size = 22 }: { category: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[category] ?? PATHS.other}
    </svg>
  );
}
