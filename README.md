# Campus Auction

A fair, transparent auction marketplace for campus items. Seniors list cycles, calculators and books; juniors bid in public, and every item has its own countdown.

## Stack

- Client: React + TypeScript (Vite)
- Server: Node.js + Express + Socket.IO
- Database: SQLite (better-sqlite3)

## Run locally

Requires Node.js 20 or newer.

```powershell
# terminal 1 - server
cd server
copy .env.example .env   # then set JWT_SECRET (and GEMINI_API_KEY for the assistant)
npm install
npm run dev              # http://localhost:4000/api/health

# terminal 2 - client
cd client
npm install
npm run dev              # http://localhost:5173
```

## Demo data

```powershell
cd server
npm run seed              # adds 5 demo students and 8 live auctions (keeps existing data)
npm run seed -- --reset   # WARNING: deletes ALL data first, then seeds a clean demo
```

All demo accounts use the password `demo1234`: `ravi@campus.demo` and `meena@campus.demo` (sellers), `priya@campus.demo`, `arjun@campus.demo`, `karthik@campus.demo` (buyers). Closing times are relative to when you seed (some close in 3, 6 and 12 minutes), so seed shortly before a demo.

## Tests

```powershell
cd server
npm test                               # unit tests (in-memory database)
node scripts/smoke-listings.js         # live checks against a running server
node scripts/smoke-bidding.js
node scripts/smoke-sale.js
node scripts/smoke-saved-searches.js
```

## Status

Work in progress during the hackathon (Oct 28, 2026).
