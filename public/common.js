/* Shared helpers for all three pages */
window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.$ = (id) => document.getElementById(id);
window.ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* Connects, sends "hello" on every (re)connect, shows a small status dot */
window.connect = (hello, onState, onHello) => {
  const socket = io({ transports: ['websocket', 'polling'], auth: (cb) => cb(hello()) });
  const dot = document.getElementById('conn');
  const setConn = (ok, text) => { if (dot) { dot.classList.toggle('ok', ok); dot.textContent = text; } };
  socket.on('connect', () => {
    setConn(true, 'live');
    socket.emit('hello', hello(), (res) => onHello && onHello(res));
  });
  socket.on('disconnect', () => setConn(false, 'reconnecting…'));
  socket.on('connect_error', () => setConn(false, 'reconnecting…'));
  socket.on('state', onState);
  return socket;
};
