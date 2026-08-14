<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ArmyBar from './components/ArmyBar.vue';
import ContextMenu from './components/ContextMenu.vue';
import HexMap from './components/HexMap.vue';
import Hud from './components/Hud.vue';
import { GameClient } from './api';
import { isAdjacent, MAP_INFO, TERRAIN_COSTS, type AuthProfile, type Difficulty, type Hex, type MapType, type RoomLobbyInfo, type RoomView } from './types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const connected = ref(false);
const error = ref<string | null>(null);
const auth = ref<AuthProfile | null>(null);
const rooms = ref<RoomLobbyInfo[]>([]);
const room = ref<RoomView | null>(null);
const playerId = ref<number | null>(null);
const screen = ref<'menu' | 'ai' | 'lobby'>('menu');
const burgerOpen = ref(false);
const army = ref(20);
const contextMenu = ref<{
  hex: Hex;
  x: number;
  y: number;
  relation: 'peace' | 'war' | 'alliance';
  pendingFromOwner: { kind: 'peace' | 'alliance' } | null;
} | null>(null);
let suppressNextHexClick = false;
const aiMapType = ref<MapType>('normal');
const aiCount = ref(1);
const aiDifficulty = ref<Difficulty>('medium');
const createMapType = ref<MapType>('normal');
const createMaxPlayers = ref(5);

const game = computed(() => room.value?.game ?? null);
const myPlayer = computed(() =>
  game.value && playerId.value !== null ? game.value.players.find((p) => p.id === playerId.value) ?? null : null,
);
const winner = computed(() => {
  const id = game.value?.winnerId;
  if (id == null) return null;
  return game.value?.players.find((p) => p.id === id)?.name ?? null;
});
const defeated = computed(() => {
  if (playerId.value === null || !game.value) return false;
  return game.value.players.find((p) => p.id === playerId.value)?.eliminated ?? false;
});
const isHost = computed(() => room.value !== null && room.value.hostPlayerId === playerId.value);
const showPause = computed(() => room.value?.aiMode === true);
const aiMax = computed(() => MAP_INFO[aiMapType.value].maxPlayers - 1);
const createOptions = computed(() => {
  const info = MAP_INFO[createMapType.value];
  const opts: number[] = [];
  for (let i = info.minPlayers; i <= info.maxPlayers; i++) opts.push(i);
  return opts;
});

watch(aiMapType, () => {
  if (aiCount.value > aiMax.value) aiCount.value = aiMax.value;
  if (aiCount.value < 1) aiCount.value = 1;
});

watch(createMapType, () => {
  const info = MAP_INFO[createMapType.value];
  if (createMaxPlayers.value > info.maxPlayers) createMaxPlayers.value = info.maxPlayers;
  if (createMaxPlayers.value < info.minPlayers) createMaxPlayers.value = info.minPlayers;
});

watch(
  () => room.value,
  () => closeContextMenu(),
);

const client = new GameClient();
client.onState = (_state, pid, authProfile, rms, rm) => {
  playerId.value = pid;
  auth.value = authProfile;
  rooms.value = rms;
  room.value = rm;
  error.value = null;
};
client.onError = (message) => {
  error.value = message;
};
client.onStatus = (isConnected) => {
  connected.value = isConnected;
};

function armyPoints(): number {
  const points = myPlayer.value?.points ?? 0;
  return Math.min(points, Math.max(1, Math.floor((points * army.value) / 100)));
}

function isCapturable(hex: Hex): boolean {
  const g = game.value;
  if (!g || playerId.value === null || hex.ownerId !== null || hex.attackerId !== null) return false;
  const human = g.players.find((p) => p.id === playerId.value);
  if (!human) return false;
  if (human.eliminated) return false;
  if (human.hexCount === 0) return true;
  if (human.points !== null && human.points - armyPoints() < TERRAIN_COSTS[hex.terrain]) return false;
  return g.hexes.some((h) => h.ownerId === human.id && isAdjacent(h, hex));
}

function isAdjacentToMine(hex: Hex): boolean {
  const g = game.value;
  if (!g || playerId.value === null) return false;
  return g.hexes.some((h) => h.ownerId === playerId.value && isAdjacent(h, hex));
}

function onHexClick(hex: Hex): void {
  if (suppressNextHexClick) {
    suppressNextHexClick = false;
    return;
  }
  if (playerId.value === null) return;
  if (myPlayer.value?.eliminated) return;
  const send = armyPoints();
  if (send < 1) return;
  if (hex.attackerId !== null) {
    if (hex.attackerId === playerId.value) {
      client.sendAttack(hex.q, hex.r, send);
    } else if (hex.ownerId === playerId.value || isAdjacentToMine(hex)) {
      client.sendDefend(hex.q, hex.r, send);
    }
    return;
  }
  if (isCapturable(hex)) {
    client.sendCapture(hex.q, hex.r, send);
    return;
  }
  if (hex.ownerId !== null && hex.ownerId !== playerId.value && isAdjacentToMine(hex)) {
    client.sendAttack(hex.q, hex.r, send);
  }
}

function onContextMenu(payload: { hex: Hex; x: number; y: number }): void {
  if (payload.hex.ownerId === null) {
    closeContextMenu();
    return;
  }
  const g = game.value;
  if (!g) return;
  const owner = g.players.find((p) => p.id === payload.hex.ownerId);
  if (!owner) return;
  const relation = owner.id === playerId.value ? 'peace' : owner.relation === 'ally' ? 'alliance' : 'war';
  const pendingFromOwner = g.pendingProposals.find((p) => p.from === owner.id) ?? null;
  contextMenu.value = { ...payload, relation, pendingFromOwner };
}

function onMenuDeclareWar(): void {
  if (!contextMenu.value) return;
  client.sendDeclareWar(contextMenu.value.hex.q, contextMenu.value.hex.r);
  closeContextMenu();
}

function onMenuPropose(kind: 'peace' | 'alliance'): void {
  if (!contextMenu.value) return;
  client.sendPropose(contextMenu.value.hex.q, contextMenu.value.hex.r, kind);
  closeContextMenu();
}

function onMenuRespond(accept: boolean): void {
  if (!contextMenu.value) return;
  client.sendRespondProposal(contextMenu.value.hex.q, contextMenu.value.hex.r, accept);
  closeContextMenu();
}

function closeContextMenu(): void {
  contextMenu.value = null;
}

function onMenuKeydown(e: KeyboardEvent): void {
  if (e.code === 'Escape') closeContextMenu();
}

function onMenuMouseDown(): void {
  if (contextMenu.value !== null) {
    suppressNextHexClick = true;
    closeContextMenu();
  }
}

function onMenuClick(): void {
  suppressNextHexClick = false;
}

function onMenuContextMenu(e: MouseEvent): void {
  if (contextMenu.value === null) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('.context-menu')) return;
  if (target?.closest('.hex-group')) return;
  closeContextMenu();
}

function onArmyChange(points: number): void {
  army.value = points;
}

function onPause(): void {
  client.sendPause();
}

function onRestart(): void {
  if (!window.confirm('Перезапустить игру?')) return;
  burgerOpen.value = false;
  client.sendRestart();
}

function goToMenu(): void {
  burgerOpen.value = false;
  screen.value = 'menu';
}

function goToAi(): void {
  aiMapType.value = 'normal';
  aiCount.value = 1;
  screen.value = 'ai';
}

function goToLobby(): void {
  createMapType.value = 'normal';
  createMaxPlayers.value = MAP_INFO.normal.maxPlayers;
  screen.value = 'lobby';
}

function startSolo(): void {
  client.sendStartSolo(aiMapType.value, aiCount.value, aiDifficulty.value);
}

function createRoom(): void {
  client.sendCreateRoom(createMapType.value, createMaxPlayers.value);
}

function joinRoom(id: number): void {
  client.sendJoinRoom(id);
}

function leaveRoom(): void {
  client.sendLeaveRoom();
}

function startRoom(): void {
  client.sendStartRoom();
}

function onToMenu(): void {
  if (!window.confirm('Выйти из комнаты? Игра продолжится с компьютером вместо вас.')) return;
  burgerOpen.value = false;
  client.sendToMenu();
}

function initGoogleButton(): void {
  if (!GOOGLE_CLIENT_ID || !window.google) return;
  const el = document.getElementById('google-btn');
  if (!el) return;
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => client.sendAuth(response.credential),
  });
  window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill' });
}

onMounted(() => {
  client.connect();
  window.addEventListener('mousedown', onMenuMouseDown);
  window.addEventListener('click', onMenuClick);
  window.addEventListener('keydown', onMenuKeydown);
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('contextmenu', onMenuContextMenu);
  if (GOOGLE_CLIENT_ID) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => initGoogleButton();
    document.head.appendChild(script);
  }
});

onBeforeUnmount(() => {
  client.close();
  window.removeEventListener('mousedown', onMenuMouseDown);
  window.removeEventListener('click', onMenuClick);
  window.removeEventListener('keydown', onMenuKeydown);
  window.removeEventListener('blur', closeContextMenu);
  window.removeEventListener('contextmenu', onMenuContextMenu);
});
</script>

<template>
  <main class="app">
    <template v-if="screen === 'menu' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Выбери режим игры</p>
        <button class="menu__btn" :disabled="!connected" @click="goToAi">Играть с компьютером</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLobby">Играть с людьми</button>
        <div v-if="GOOGLE_CLIENT_ID" class="menu__google">
          <div v-if="auth" class="menu__auth">Вы вошли как {{ auth.name }}</div>
          <div v-else id="google-btn"></div>
        </div>
      </div>
    </template>

    <template v-else-if="screen === 'ai' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Игра с компьютером</p>
        <select v-model="aiMapType" class="menu__select">
          <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
            {{ info.label }} — {{ info.description }}
          </option>
        </select>
        <div class="menu__row">
          <span class="menu__label">Компьютеров:</span>
          <select v-model.number="aiCount" class="menu__select">
            <option v-for="n in aiMax" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <div class="menu__row">
          <span class="menu__label">Сложность:</span>
          <select v-model="aiDifficulty" class="menu__select">
            <option value="easy">Лёгкая</option>
            <option value="medium">Средняя</option>
            <option value="hard">Сложная</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startSolo">Начать игру</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">В меню</button>
      </div>
    </template>

    <template v-else-if="screen === 'lobby' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Игра с людьми — открытые комнаты</p>
        <div class="lobby">
          <div v-for="r in rooms" :key="r.id" class="lobby__room" @click="joinRoom(r.id)">
            <span class="lobby__name">{{ r.name }}</span>
            <span class="lobby__map">{{ MAP_INFO[r.mapType].label }}</span>
            <span class="lobby__players">{{ r.humans }}/{{ r.maxPlayers }}</span>
          </div>
          <div v-if="rooms.length === 0" class="lobby__empty">Открытых комнат нет</div>
        </div>
        <div class="lobby__create">
          <h3 class="lobby__create-title">Создать комнату</h3>
          <select v-model="createMapType" class="menu__select">
            <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
              {{ info.label }} — {{ info.description }}
            </option>
          </select>
          <select v-model.number="createMaxPlayers" class="menu__select">
            <option v-for="n in createOptions" :key="n" :value="n">{{ n }} игроков</option>
          </select>
          <button class="menu__btn" :disabled="!connected" @click="createRoom">Создать</button>
        </div>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">В меню</button>
      </div>
    </template>

    <template v-else-if="room && room.status === 'waiting'">
      <div class="menu">
        <h1 class="menu__title">{{ room.name }}</h1>
        <p class="menu__subtitle">
          Карта: {{ MAP_INFO[room.mapType].label }} · {{ room.slots.length }}/{{ room.maxPlayers }} игроков
        </p>
        <div class="lobby">
          <div v-for="s in room.slots" :key="s.id" class="lobby__room">
            <span class="lobby__name">{{ s.name }}</span>
            <span v-if="s.id === room.hostPlayerId" class="lobby__host">хозяин</span>
          </div>
          <div v-if="room.maxPlayers - room.slots.length > 0" class="lobby__empty">
            Свободно мест: {{ room.maxPlayers - room.slots.length }}
          </div>
        </div>
        <button v-if="isHost" class="menu__btn" :disabled="!connected" @click="startRoom">Начать игру</button>
        <p v-else class="menu__waiting">Ожидание начала игры хозяином…</p>
        <button class="menu__btn menu__btn--ghost" @click="leaveRoom">Покинуть комнату</button>
      </div>
    </template>

    <template v-else-if="room && game">
      <div class="game-screen">
        <div class="app__header">
          <h1>{{ room.name }}</h1>
          <div class="app__controls">
            <button v-if="showPause" class="app__btn" :disabled="!connected" @click="onPause">
              {{ room.paused ? 'Продолжить' : 'Пауза' }}
            </button>
            <button class="app__btn app__burger" @click="burgerOpen = !burgerOpen">☰</button>
          </div>
        </div>
        <div v-if="room.paused && !winner" class="banner banner--pause">Пауза</div>
        <div v-if="winner && defeated" class="banner banner--error banner--center">Поражение: {{ winner }}!</div>
        <div v-else-if="winner" class="banner banner--win banner--center">Победа: {{ winner }}!</div>
        <div v-else-if="!connected" class="banner banner--warn">Подключение…</div>
        <div v-if="error" class="banner banner--error">{{ error }}</div>
        <Hud v-if="game" :game="game" :human-id="playerId" :army="army" />
        <HexMap
          v-if="game"
          :hexes="game.hexes"
          :players="game.players"
          :capture-ticks="game.captureTicks"
          :menu-open="contextMenu !== null"
          @click="onHexClick"
          @contextmenu="onContextMenu"
        />
        <ContextMenu
          v-if="contextMenu"
          :hex="contextMenu.hex"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :players="game.players"
          :human-id="playerId"
          :relation="contextMenu.relation"
          :pending-from-owner="contextMenu.pendingFromOwner"
          @close="closeContextMenu"
          @declare-war="onMenuDeclareWar"
          @propose="onMenuPropose"
          @respond="onMenuRespond"
        />
        <ArmyBar v-if="game" :game="game" :human-id="playerId" :army="army" @army-change="onArmyChange" />
        <div v-if="room.log?.length" class="log-panel">
          <div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry">{{ entry }}</div>
        </div>
      </div>
    </template>

    <div v-if="burgerOpen" class="burger-overlay" @click.self="burgerOpen = false">
      <div class="burger-menu">
        <button v-if="room?.aiMode" class="burger-menu__item" @click="onRestart">Перезапустить игру</button>
        <button class="burger-menu__item" @click="onToMenu">Выйти в меню</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.game-screen {
  position: fixed;
  inset: 0;
}

.app__header {
  position: fixed;
  top: 12px;
  right: 16px;
  left: auto;
  width: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  margin: 0;
  z-index: 40;
}

.app__controls {
  display: flex;
  gap: 8px;
}

.app__header h1 {
  margin: 0;
  font-size: 17px;
  color: #ccc;
  white-space: nowrap;
}

.app__btn {
  padding: 6px 14px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a31;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.app__btn:hover:not(:disabled) {
  background: #3a3a44;
}

.app__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.app__burger {
  font-size: 18px;
  line-height: 1;
}

.menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin-top: 15vh;
}

.menu__title {
  font-size: 44px;
  margin: 0;
}

.menu__subtitle {
  color: #999;
  margin: 0 0 10px;
}

.menu__btn {
  padding: 12px 32px;
  border: none;
  border-radius: 8px;
  background: #2196f3;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  min-width: 260px;
}

.menu__btn:hover:not(:disabled) {
  background: #1976d2;
}

.menu__btn--ghost {
  background: #2a2a31;
  border: 1px solid #555;
}

.menu__btn--ghost:hover:not(:disabled) {
  background: #3a3a44;
}

.menu__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.menu__select {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #555;
  background: #2a2a31;
  color: #fff;
  font-size: 15px;
  min-width: 260px;
}

.menu__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu__label {
  color: #ccc;
}

.menu__waiting {
  font-size: 18px;
  color: #ffd54f;
  margin: 0;
}

.menu__google {
  margin-top: 6px;
  min-height: 40px;
}

.menu__auth {
  color: #ce93d8;
  font-weight: 600;
}

.lobby {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  max-height: 260px;
  overflow-y: auto;
}

.lobby__room {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #2a2a31;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
}

.lobby__room:hover {
  background: #3a3a44;
}

.lobby__name {
  font-weight: 700;
}

.lobby__map {
  color: #999;
  font-size: 13px;
}

.lobby__players {
  margin-left: auto;
  color: #ffd54f;
  font-weight: 600;
}

.lobby__host {
  color: #ffd54f;
  font-size: 12px;
}

.lobby__empty {
  color: #777;
  text-align: center;
  padding: 10px;
}

.lobby__create {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #444;
  padding-top: 14px;
  width: 100%;
  max-width: 420px;
}

.lobby__create-title {
  margin: 0;
  color: #ccc;
}

.banner {
  padding: 8px 20px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  position: relative;
  z-index: 40;
}

.banner--win {
  background: #2e7d32;
  color: #fff;
}

.banner--warn {
  background: #555;
  color: #fff;
}

.banner--pause {
  background: #6a1b9a;
  color: #fff;
}

.banner--error {
  background: #c62828;
  color: #fff;
}

.banner--center {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 60;
  font-size: 26px;
  padding: 14px 34px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
}

.log-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 420px;
  max-height: 260px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.78);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  font-family: monospace;
  color: #ccc;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 10;
}

.log-panel__entry {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 4px;
  word-break: break-word;
}

.log-panel__entry:last-child {
  border-bottom: none;
}

.burger-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
  justify-content: flex-end;
}

.burger-menu {
  background: #1e1e24;
  border-left: 1px solid #444;
  min-width: 220px;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.burger-menu__item {
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.burger-menu__item:hover {
  background: #2a2a31;
}
</style>
