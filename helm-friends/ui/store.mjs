// A tiny state store: one object, shallow updates, subscribers told which keys changed.

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    /** @returns {T} */
    get: () => state,
    /** Shallow merge; subscribers get (state, changedKeys). Unchanged values (===) don't notify. */
    set(patch) {
      const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
      if (!changed.length) return;
      state = { ...state, ...patch };
      for (const fn of [...subs]) fn(state, changed);
    },
    /** fn(state, changedKeys) → unsubscribe */
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** localStorage that never throws (private windows, blocked storage, Twitch iframes). */
export const safeStorage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  getJson(k, fallback = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
