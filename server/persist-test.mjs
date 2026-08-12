import { WebSocket } from 'ws';
const URL = 'ws://localhost:5173/ws';
const ws = new WebSocket(URL);
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'menu' }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.game && m.game.phase === 'game' && !m.game.hexes.some(h => h.q === 5 && h.r === 5 && h.ownerId !== null)) {
    ws.send(JSON.stringify({ type: 'capture', q: 5, r: 5 }));
  }
  if (m.game && m.game.hexes.some(h => h.q === 5 && h.r === 5 && h.ownerId !== null)) {
    console.log('captured, hex 5,5 owner:', m.game.hexes.find(h => h.q === 5 && h.r === 5).ownerId);
    ws.close();
    process.exit(0);
  }
});
