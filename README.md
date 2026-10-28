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

## Status

Work in progress during the hackathon (Oct 28, 2026).
