// Connection layer. PeerJS (WebRTC, free cloud signalling) by default; `local` uses a
// BroadcastChannel so two tabs on one PC can test co-op with no internet.
// Conn interface: { send(msg), onData(cb), onClose(cb), close() }

const PREFIX = 'trex-';
const CONNECT_TIMEOUT_MS = 15000;

// Messages go as plain JSON text over a 'raw' channel (joiners ask for it in connectToHost). PeerJS's own 'json' mode
// refuses any message over ~16 KB ("Message too big for JSON channel"), and late-wave snapshots get that big: that
// error used to count as a disconnect and kicked mates mid-game (21 Oct). Old pages still on 'json' keep working.
function wrapPeerConn(c) {
  const raw = c.serialization === 'raw';
  const conn = {
    send: (m) => { if (c.open) c.send(raw ? JSON.stringify(m) : m); },
    onData: (cb) => c.on('data', (d) => {
      if (!raw) { cb(d); return; }
      let m;
      try { m = JSON.parse(d); } catch (e) { return; }
      cb(m);
    }),
    // Only a closed channel ends the link. PeerJS also emits 'error' for a single failed send.
    onClose: (cb) => {
      c.on('close', cb);
      c.on('error', (e) => { console.warn('connection error', e?.type || e); if (!c.open) cb(); });
    },
    close: () => c.close(),
    get bufferedAmount() { return c.dataChannel?.bufferedAmount || 0; },
  };
  return conn;
}

/**
 * Open a room as host.
 * @returns {Promise<{onJoin:(cb:(conn)=>void)=>void, close:()=>void}>}
 */
export function createHostTransport(code, { local = false } = {}) {
  if (local) return Promise.resolve(createLocalHost(code));
  return new Promise((resolve, reject) => {
    const Peer = globalThis.Peer;
    if (!Peer) { reject(new Error('PeerJS failed to load')); return; }
    const peer = new Peer(PREFIX + code.toLowerCase(), { debug: 1 });
    let joinCb = () => {};
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ onJoin: (cb) => { joinCb = cb; }, close: () => peer.destroy(), peer, keepAlive: () => keepAlive(peer) });
    });
    peer.on('connection', (c) => {
      c.on('open', () => joinCb(wrapPeerConn(c)));
    });
    peer.on('disconnected', () => { if (opened) peer.reconnect(); });
    peer.on('error', (err) => {
      if (!opened) reject(new Error(err.type === 'unavailable-id' ? 'That room code is taken. Try again.' : `Network error (${err.type})`));
      else console.warn('peer error', err.type);
    });
  });
}

/**
 * The host's room only exists while its peer is registered with the PeerJS signalling server. PeerJS sends its
 * heartbeat from a main-thread timer, which browsers throttle hard in hidden tabs, so the server can drop the room
 * while the host is alt-tabbed and nobody can rejoin. The host calls this from its game loop (which keeps running in a
 * hidden tab): reconnect if dropped, else send a heartbeat ourselves.
 */
function keepAlive(peer) {
  try {
    if (peer.destroyed) return;
    if (peer.disconnected) { peer.reconnect(); return; }
    const ws = peer.socket && peer.socket._socket;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
  } catch (e) { /* best effort */ }
}

/** Join a room. @returns {Promise<conn>} */
export function connectToHost(code, { local = false } = {}) {
  if (local) return connectLocal(code);
  return new Promise((resolve, reject) => {
    const Peer = globalThis.Peer;
    if (!Peer) { reject(new Error('PeerJS failed to load')); return; }
    const peer = new Peer({ debug: 1 });
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('Could not reach the host. Check the code, or the host may be behind a strict firewall.')); }, CONNECT_TIMEOUT_MS);
    peer.on('open', () => {
      const c = peer.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'raw' });
      c.on('open', () => { clearTimeout(timer); const conn = wrapPeerConn(c); conn.peer = peer; resolve(conn); });
      c.on('error', (e) => { clearTimeout(timer); reject(new Error(`Connection failed (${e.type || e.message})`)); });
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.type === 'peer-unavailable' ? 'No game with that code. Check it and try again.' : `Network error (${err.type})`));
    });
  });
}

// ---- BroadcastChannel transport (same browser, testing) ----

function createLocalHost(code) {
  const ch = new BroadcastChannel(PREFIX + code);
  const conns = new Map();
  let joinCb = () => {};
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (m.to !== 'host') return;
    if (m.kind === 'hello') {
      const handlers = { data: [], close: [] };
      const conn = {
        send: (msg) => ch.postMessage({ to: m.from, kind: 'data', msg: JSON.parse(JSON.stringify(msg)) }),
        onData: (cb) => handlers.data.push(cb),
        onClose: (cb) => handlers.close.push(cb),
        close: () => { ch.postMessage({ to: m.from, kind: 'close' }); handlers.close.forEach((f) => f()); conns.delete(m.from); },
        handlers,
      };
      conns.set(m.from, conn);
      ch.postMessage({ to: m.from, kind: 'welcome' });
      joinCb(conn);
    } else if (m.kind === 'data') conns.get(m.from)?.handlers.data.forEach((f) => f(m.msg));
    else if (m.kind === 'close') { const c = conns.get(m.from); if (c) { c.handlers.close.forEach((f) => f()); conns.delete(m.from); } }
  };
  addEventListener('beforeunload', () => { for (const id of conns.keys()) ch.postMessage({ to: id, kind: 'close' }); });
  return { onJoin: (cb) => { joinCb = cb; }, close: () => { for (const id of conns.keys()) ch.postMessage({ to: id, kind: 'close' }); ch.close(); } };
}

function connectLocal(code) {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(PREFIX + code);
    const me = 'c' + Math.random().toString(36).slice(2, 9);
    const handlers = { data: [], close: [] };
    const timer = setTimeout(() => { ch.close(); reject(new Error('No local host with that code.')); }, 4000);
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.to !== me) return;
      if (m.kind === 'welcome') {
        clearTimeout(timer);
        resolve({
          send: (msg) => ch.postMessage({ to: 'host', from: me, kind: 'data', msg: JSON.parse(JSON.stringify(msg)) }),
          onData: (cb) => handlers.data.push(cb),
          onClose: (cb) => handlers.close.push(cb),
          close: () => { ch.postMessage({ to: 'host', from: me, kind: 'close' }); ch.close(); },
        });
      } else if (m.kind === 'data') handlers.data.forEach((f) => f(m.msg));
      else if (m.kind === 'close') handlers.close.forEach((f) => f());
    };
    addEventListener('beforeunload', () => ch.postMessage({ to: 'host', from: me, kind: 'close' }));
    ch.postMessage({ to: 'host', from: me, kind: 'hello' });
  });
}

/** 5-character room code without look-alike characters. */
export function makeRoomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
