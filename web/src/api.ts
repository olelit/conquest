import type { AuthProfile, ClientMessage, GameState, MapType, RoomLobbyInfo, RoomView, ServerMessage } from './types';

const MAX_RECONNECT_DELAY_MS = 10000;

export class GameClient {
  onState: (
    state: GameState | null,
    playerId: number | null,
    auth: AuthProfile | null,
    rooms: RoomLobbyInfo[],
    room: RoomView | null,
  ) => void = () => {};
  onError: (message: string) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  private ws: WebSocket | null = null;
  private attempt = 0;
  private closed = false;

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  sendCapture(q: number, r: number, army = 0): void {
    this.send({ type: 'capture', q, r, army });
  }

  sendAttack(q: number, r: number, points: number): void {
    this.send({ type: 'attack', q, r, points });
  }

  sendDefend(q: number, r: number, points: number): void {
    this.send({ type: 'defend', q, r, points });
  }

  sendPause(): void {
    this.send({ type: 'pause' });
  }

  sendRestart(): void {
    this.send({ type: 'restart' });
  }

  sendToMenu(): void {
    this.send({ type: 'menu' });
  }

  sendStartSolo(mapType: MapType, aiCount: number): void {
    this.send({ type: 'start-solo', mapType, aiCount });
  }

  sendCreateRoom(mapType: MapType, maxPlayers: number): void {
    this.send({ type: 'create-room', mapType, maxPlayers });
  }

  sendJoinRoom(roomId: number): void {
    this.send({ type: 'join-room', roomId });
  }

  sendLeaveRoom(): void {
    this.send({ type: 'leave-room' });
  }

  sendStartRoom(): void {
    this.send({ type: 'start-room' });
  }

  sendAuth(token: string): void {
    this.send({ type: 'auth', token });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private open(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus(true);
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'state') {
        this.onState(msg.room?.game ?? null, msg.playerId, msg.auth, msg.rooms, msg.room);
      } else if (msg.type === 'error') {
        this.onError(msg.message);
      }
    };

    ws.onclose = () => {
      this.onStatus(false);
      if (this.closed) return;
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.attempt);
      this.attempt++;
      setTimeout(() => this.open(), delay);
    };
  }
}
