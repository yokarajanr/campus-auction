import db from '../db.js';

let io = null;

export function setIo(server) {
  io = server;
}

export function emitAuctionUpdate(auctionId, payload = {}) {
  io?.to(`auction:${auctionId}`).emit('auction:update', { auctionId, ...payload });
  io?.emit('auctions:changed', { auctionId });
}

export function notify(userId, type, message, auctionId = null) {
  const createdAt = Date.now();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notifications (user_id, type, message, auction_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, message, auctionId, createdAt);
  io?.to(`user:${userId}`).emit('notification', {
    id: Number(lastInsertRowid), type, message, auctionId, read: false, createdAt,
  });
}
