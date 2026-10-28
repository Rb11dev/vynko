export type PublicUser = { id: number; username: string; displayName: string; avatarUrl: string | null };
export type Presence = { online: boolean; lastSeenAt: number | null };
export type UserWithPresence = PublicUser & Presence;
export type Me = PublicUser & { showOnline: boolean; showLastSeen: boolean; createdAt: number };
export type Message = {
  id: number; conversationId: number; senderId: number; body: string; clientId: string | null;
  createdAt: number; deliveredAt: number | null; readAt: number | null;
};
export type Conversation = {
  id: number; other: UserWithPresence; lastBody: string | null; lastSender: number | null; lastMessageAt: number | null; unread: number;
};
export type CallRecord = {
  id: string; type: 'audio' | 'video'; direction: 'incoming' | 'outgoing';
  status: 'completed' | 'missed' | 'unanswered' | 'rejected' | 'cancelled' | 'failed' | 'busy';
  createdAt: number; connectedAt: number | null; durationSec: number | null; other: PublicUser;
};
export type Meeting = {
  code: string; title: string; hostName: string; allowGuests: boolean; maxParticipants: number;
  status: 'active' | 'expired' | 'revoked' | 'ended'; expiresAt: number; createdAt: number;
};
export type Signal = { description?: { type: 'offer' | 'answer'; sdp: string }; candidate?: RTCIceCandidateInit };
