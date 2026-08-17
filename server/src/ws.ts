import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { MapType } from './map.js';
import type { Difficulty } from './config.js';
import type { RoomManager } from './rooms.js';

interface WsMessage {
  type: string;
  q?: number;
  r?: number;
  points?: number;
  army?: number;
  kind?: string;
  accept?: boolean;
  token?: string;
  mapType?: string;
  maxPlayers?: number;
  aiCount?: number;
  roomId?: number;
  difficulty?: string;
  training?: boolean;
}

export function attachWs(server: Server, manager: RoomManager): () => void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connIds = new Map<WebSocket, number>();
  let connCounter = 0;

  const statePayload = (connId: number): string => {
    return JSON.stringify({
      type: 'state',
      playerId: manager.viewerPlayerId(connId),
      auth: manager.authProfileFor(connId),
      rooms: manager.lobby(),
      room: manager.roomForConn(connId)?.view(manager.viewerPlayerId(connId)) ?? null,
    });
  };

  const broadcast = (): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        const connId = connIds.get(client);
        if (connId !== undefined) client.send(statePayload(connId));
      }
    }
  };

  const sendError = (ws: WebSocket, message: string): void => {
    ws.send(JSON.stringify({ type: 'error', message }));
  };

  wss.on('connection', (ws) => {
    const connId = ++connCounter;
    connIds.set(ws, connId);
    broadcast();

    ws.on('message', async (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendError(ws, 'Invalid JSON');
        return;
      }
      if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
        sendError(ws, 'Invalid message');
        return;
      }
      const message = msg as WsMessage;
      try {
        switch (message.type) {
          case 'auth': {
            const result = await manager.handleAuth(connId, String(message.token ?? ''));
            if (result.ok) {
              broadcast();
            } else {
              sendError(ws, result.error ?? 'Login error');
            }
            return;
          }
          case 'menu':
          case 'leave-room':
            manager.leaveRoom(connId);
            broadcast();
            return;
          case 'start-solo': {
            const result = manager.createSolo(connId, String(message.mapType ?? '') as MapType, Number(message.aiCount), (message.difficulty ?? 'medium') as Difficulty, Boolean(message.training));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'start-load-test': {
            const result = manager.createLoadTest(connId, Number(message.aiCount));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'create-room': {
            const result = manager.createRoom(connId, String(message.mapType ?? '') as MapType, Number(message.maxPlayers));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'join-room': {
            const result = manager.joinRoom(connId, Number(message.roomId));
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'start-room': {
            const result = manager.startRoom(connId);
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'restart': {
            const result = manager.restart(connId);
            if (result.ok) broadcast();
            else sendError(ws, result.error);
            return;
          }
          case 'declare-war':
          case 'propose':
          case 'respond-proposal':
          case 'build-fortress':
          case 'remove-fortress':
          case 'end-game': {
            const result = manager.handleAction(connId, message as { type: string; q?: number; r?: number; kind?: string; accept?: boolean });
            if (result.type === 'state') broadcast();
            else ws.send(JSON.stringify(result));
            return;
          }
        }
        const result = manager.handleAction(connId, message);
        if (result.type === 'state') {
          broadcast();
        } else {
          ws.send(JSON.stringify(result));
        }
      } catch (err) {
        console.error('ws handler failed:', err);
        sendError(ws, 'Server error');
      }
    });

    ws.on('close', () => {
      connIds.delete(ws);
      manager.connectionClosed(connId);
      broadcast();
    });
  });

  return broadcast;
}
