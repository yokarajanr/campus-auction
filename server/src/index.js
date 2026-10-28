import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import './db.js';
import { errorHandler } from './errors.js';
import authRoutes from './routes/auth.js';

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

app.use('/api/auth', authRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

io.on('connection', (socket) => {
  socket.emit('hello', { serverNow: Date.now() });
});

server.listen(PORT, () => {
  console.log(`Campus Auction server listening on http://localhost:${PORT}`);
});
