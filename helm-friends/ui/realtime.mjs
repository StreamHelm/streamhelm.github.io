// Live updates (DESIGN §1.2): SSE from our server first (a single-use ticket because EventSource can't send headers),
// then polling every 20 s while the page is visible as the last resort. The Twitch panel also feeds Extension PubSub
// "refresh" notes in through `poke()`.

const EVENTS = ['hello', 'balance', 'unlocks', 'character', 'catalog', 'rewards', 'prediction', 'game', 'stage', 'season', 'toast', 'live', 'challenges'];   // v1.14: + live, challenges

/**
 * @param {{ api:Object, authed:()=>boolean, onEvent:(type:string, data:Object)=>void, onPoll:()=>Promise<void>,
 *           pollMs?:number, sse?:boolean }} o
 * @returns {{ stop():void, poke(type:string):void, mode():string }}
 */
export function connectRealtime({ api, authed, onEvent, onPoll, pollMs = 20000, sse = true }) {
  let es = null, timer = null, stopped = false, mode = 'none', retry = 0;

  const startPolling = () => {
    if (timer || stopped) return;
    mode = 'poll';
    timer = setInterval(() => { if (document.visibilityState === 'visible') onPoll().catch(() => {}); }, pollMs);
  };

  async function open() {
    if (stopped) return;
    if (!sse || typeof EventSource !== 'function') return startPolling();
    let ticket = null;
    if (authed()) { try { ticket = (await api.streamTicket()).ticket; } catch { /* public topics only */ } }
    try { es = new EventSource(api.streamUrl(ticket)); } catch { return startPolling(); }
    for (const t of EVENTS) es.addEventListener(t, (m) => { let d = {}; try { d = JSON.parse(m.data); } catch { /* ignore */ } onEvent(t, d); });
    es.onopen = () => { mode = 'sse'; retry = 0; if (timer) { clearInterval(timer); timer = null; } };
    es.onerror = () => {
      // EventSource retries by itself with the same (now used) ticket, so close and reopen with a new one
      if (es) es.close();
      es = null;
      startPolling();
      retry = Math.min(retry + 1, 6);
      if (!stopped) setTimeout(open, 2000 * 2 ** retry);
    };
  }

  open();
  return {
    stop() { stopped = true; if (es) es.close(); if (timer) clearInterval(timer); },
    poke(type) { onEvent(type, {}); },
    mode: () => mode,
  };
}
