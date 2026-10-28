// Tracks which sockets (browser tabs) each user currently has open.
export function createPresence() {
  const map = new Map(); // userId -> Set(socketId)
  return {
    add(userId, socketId) {
      let s = map.get(userId);
      const first = !s || s.size === 0;
      if (!s) map.set(userId, (s = new Set()));
      s.add(socketId);
      return first; // true when the user just came online
    },
    remove(userId, socketId) {
      const s = map.get(userId);
      if (!s) return false;
      s.delete(socketId);
      if (s.size === 0) { map.delete(userId); return true; } // true when the user just went offline
      return false;
    },
    sockets: (userId) => [...(map.get(userId) ?? [])],
    isOnline: (userId) => (map.get(userId)?.size ?? 0) > 0,
  };
}
