-- All times are Unix epoch milliseconds (server clock). All money is whole rupees.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id      INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  condition      TEXT NOT NULL,
  photos_json    TEXT NOT NULL DEFAULT '[]',
  start_price    INTEGER NOT NULL CHECK (start_price >= 0),
  min_increment  INTEGER NOT NULL CHECK (min_increment >= 1),
  ends_at        INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'live' CHECK (status IN (
                   'live', 'cancelled', 'unsold', 'awaiting_seller',
                   'rejected', 'reserved', 'completed', 'failed_pickup')),
  current_price  INTEGER,
  leader_id      INTEGER REFERENCES users(id),
  winner_id      INTEGER REFERENCES users(id),
  pickup_code    TEXT,
  outcome_note   TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auctions_status_ends ON auctions(status, ends_at);

CREATE TABLE IF NOT EXISTS bids (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id  INTEGER NOT NULL REFERENCES auctions(id),
  bidder_id   INTEGER NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  is_auto     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, id);

CREATE TABLE IF NOT EXISTS auto_bids (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id  INTEGER NOT NULL REFERENCES auctions(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  max_amount  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (auction_id, user_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id   INTEGER NOT NULL REFERENCES auctions(id),
  asker_id     INTEGER NOT NULL REFERENCES users(id),
  text         TEXT NOT NULL,
  answer       TEXT,
  hidden       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  answered_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_questions_auction ON questions(auction_id);

CREATE TABLE IF NOT EXISTS question_votes (
  question_id INTEGER NOT NULL REFERENCES questions(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  keyword     TEXT NOT NULL DEFAULT '',
  category    TEXT,
  condition   TEXT,
  max_price   INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  auction_id  INTEGER REFERENCES auctions(id),
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
