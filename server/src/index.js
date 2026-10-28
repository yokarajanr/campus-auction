import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, serverNow: Date.now() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

io.on('connection', (socket) => {
  socket.emit('hello', { serverNow: Date.now() });
});

server.listen(PORT, () => {
  console.log(`Campus Auction server listening on http://localhost:${PORT}`);
});
