// Small in-memory fixed-window rate limiter. Fine for one server process.
// (If you run several server copies, move this to a shared store such as Redis.)
export function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  const sweep = (t) => { for (const [k, e] of hits) if (e.reset <= t) hits.delete(k); };
  return {
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        if (hits.size > 20000) sweep(t);
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      return { ok: e.count <= max, retryAfterSec: Math.max(1, Math.ceil((e.reset - t) / 1000)) };
    },
    reset(key) { hits.delete(key); },
  };
}
