export type AuctionStatus =
  | 'live'
  | 'cancelled'
  | 'unsold'
  | 'awaiting_seller'
  | 'rejected'
  | 'reserved'
  | 'completed'
  | 'failed_pickup';

export interface User {
  id: number;
  name: string;
  email?: string;
}

export interface Auction {
  id: number;
  sellerId: number;
  sellerName: string;
  title: string;
  category: string;
  description: string;
  condition: string;
  photos: string[];
  startPrice: number;
  minIncrement: number;
  endsAt: number;
  status: AuctionStatus;
  currentPrice: number | null;
  leaderId: number | null;
  leaderName: string | null;
  winnerId: number | null;
  winnerName: string | null;
  bidCount: number;
  nextMinBid: number;
  outcomeNote: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Bid {
  id: number;
  bidderId: number;
  bidderName: string;
  amount: number;
  isAuto: boolean;
  createdAt: number;
}

export interface AutoBid {
  userId: number;
  userName: string;
  maxAmount: number;
  updatedAt: number;
}

export interface AuctionDetail {
  auction: Auction;
  bids: Bid[];
  autoBids: AutoBid[];
  pickupCode: string | null;
  serverNow: number;
}

export interface SavedSearch {
  id: number;
  keyword: string;
  category: string | null;
  condition: string | null;
  maxPrice: number | null;
  label: string;
  liveMatches?: number;
  createdAt: number;
}

export interface AppNotification {
  id: number;
  type: string;
  message: string;
  auctionId: number | null;
  read: boolean;
  createdAt: number;
}
