import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import './db.js';
import { errorHandler } from './errors.js';
import authRoutes from './routes/auth.js';
import auctionRoutes from './routes/auctions.js';
import bidRoutes from './routes/bids.js';
import { startCloser } from './services/closer.js';
import { UPLOADS_DIR } from './upload.js';
import { setIo } from './services/realtime.js';

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1d' }));
app.use('/api/auth', authRoutes);
app.use('/api/auctions', auctionRoutes);
app.use('/api/auctions', bidRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });
setIo(io);

io.on('connection', (socket) => {
  socket.emit('hello', { serverNow: Date.now() });
  socket.on('auction:join', (id) => {
    if (Number.isInteger(id)) socket.join(`auction:${id}`);
  });
  socket.on('auction:leave', (id) => {
    if (Number.isInteger(id)) socket.leave(`auction:${id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Campus Auction server listening on http://localhost:${PORT}`);
  startCloser();
});
