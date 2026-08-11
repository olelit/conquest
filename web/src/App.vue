<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ArmyBar from './components/ArmyBar.vue';
import HexMap from './components/HexMap.vue';
import Hud from './components/Hud.vue';
import { GameClient } from './api';
import { isAdjacent, TERRAIN_COSTS, type AuthProfile, type GameState, type Hex } from './types';

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

const game = ref<GameState | null>(null);
const connected = ref(false);
const error = ref<string | null>(null);
const selected = ref<Hex | null>(null);
const viewerId = ref<number | null>(null);
const isWaiter = ref(false);
const auth = ref<AuthProfile | null>(null);
const burgerOpen = ref(false);
const army = ref(200);

const myPlayer = computed(() =>
  game.value && viewerId.value !== null ? game.value.players.find((p) => p.id === viewerId.value) ?? null : null,
);

watch(
  () => myPlayer.value?.points ?? 0,
  (points) => {
    if (army.value > points) army.value = points;
  },
);

const client = new GameClient();
client.onState = (state, playerId, waiting, authProfile) => {
  game.value = state;
  viewerId.value = playerId;
  isWaiter.value = waiting;
  auth.value = authProfile;
  error.value = null;
  if (selected.value) {
    const fresh = state.hexes.find((h) => h.q === selected.value!.q && h.r === selected.value!.r);
    selected.value = fresh ?? null;
  }
};
client.onError = (message) => {
  error.value = message;
};
client.onStatus = (isConnected) => {
  connected.value = isConnected;
};

const winner = computed(() => {
  if (!game.value?.winnerId) return null;
  const w = game.value.players.find((p) => p.id === game.value!.winnerId);
  return w ? w.name : null;
});

function onSelect(pos: { q: number; r: number }): void {
  selected.value = game.value?.hexes.find((h) => h.q === pos.q && h.r === pos.r) ?? null;
}

function isCapturable(hex: Hex): boolean {
  const g = game.value;
  if (!g || viewerId.value === null || hex.ownerId !== null || hex.attackerId !== null) return false;
  const human = g.players.find((p) => p.id === viewerId.value);
  if (!human) return false;
  if (human.hexCount === 0) return true;
  if (human.points - army.value < TERRAIN_COSTS[hex.terrain]) return false;
  return g.hexes.some((h) => h.ownerId === human.id && isAdjacent(h, hex));
}

function isAdjacentToMine(hex: Hex): boolean {
  const g = game.value;
  if (!g || viewerId.value === null) return false;
  return g.hexes.some((h) => h.ownerId === viewerId.value && isAdjacent(h, hex));
}

function onHexClick(hex: Hex): void {
  if (viewerId.value === null) return;
  if (hex.attackerId !== null) {
    const send = Math.max(1, Math.min(army.value, myPlayer.value?.points ?? 0));
    if (hex.attackerId === viewerId.value) {
      client.sendAttack(hex.q, hex.r, send);
    } else if (hex.ownerId === viewerId.value || isAdjacentToMine(hex)) {
      client.sendDefend(hex.q, hex.r, send);
    } else {
      onSelect({ q: hex.q, r: hex.r });
    }
    return;
  }
  if (isCapturable(hex)) {
    client.sendCapture(hex.q, hex.r, army.value);
  } else {
    onSelect({ q: hex.q, r: hex.r });
  }
}

function onArmyChange(points: number): void {
  army.value = points;
}

function onPause(): void {
  client.sendPause();
}

function onToMenu(): void {
  if (!window.confirm('Вернуться в меню? Текущий прогресс игры будет потерян.')) return;
  selected.value = null;
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
});
</script>

<template>
  <main class="app">
    <template v-if="game?.phase === 'menu'">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">Выбери режим игры</p>
        <button class="menu__btn" :disabled="!connected" @click="client.sendStartAi()">
          Играть с компьютером
        </button>
        <button class="menu__btn" :disabled="!connected" @click="client.sendStartHuman()">
          Играть с человеком
        </button>
        <div v-if="GOOGLE_CLIENT_ID" class="menu__google">
          <div v-if="auth" class="menu__auth">Вы вошли как {{ auth.name }}</div>
          <div v-else id="google-btn"></div>
        </div>
        <p class="menu__hint">
          Для игры с человеком открой игру во втором окне/вкладке — второй игрок нажмёт
          «Играть с человеком» и попадёт в игру.
        </p>
      </div>
    </template>

    <template v-else-if="game?.phase === 'waiting'">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p v-if="isWaiter" class="menu__waiting">Ожидание второго игрока…</p>
        <p v-else class="menu__waiting">Игра ждёт второго игрока</p>
        <button v-if="isWaiter" class="menu__btn" :disabled="!connected" @click="client.sendCancelWaiting()">
          Отмена
        </button>
        <template v-else>
          <button class="menu__btn" :disabled="!connected" @click="client.sendStartHuman()">
            Присоединиться
          </button>
          <button class="menu__btn menu__btn--ghost" :disabled="!connected" @click="client.sendToMenu()">
            В меню
          </button>
        </template>
      </div>
    </template>

    <template v-else-if="game">
      <div class="app__header">
        <h1>Conquest</h1>
        <button class="app__btn" :disabled="!connected" @click="onPause">
          {{ game.paused ? 'Продолжить' : 'Пауза' }}
        </button>
        <button class="app__btn app__burger" :disabled="!connected" @click="burgerOpen = !burgerOpen">
          ☰
        </button>
      </div>
      <div v-if="game.paused && !winner" class="banner banner--pause">Пауза</div>
      <div v-else-if="winner" class="banner banner--win">Победа: {{ winner }}!</div>
      <div v-else-if="!connected" class="banner banner--warn">Подключение…</div>
      <div v-else-if="!game" class="banner banner--warn">Ожидание состояния…</div>
      <div v-if="error" class="banner banner--error">{{ error }}</div>
      <Hud v-if="game" :game="game" :human-id="viewerId" />
      <HexMap
        v-if="game"
        :hexes="game.hexes"
        :players="game.players"
        :human-id="viewerId"
        :capture-ticks="game.captureTicks"
        @click="onHexClick"
        @select="onSelect"
      />
      <ArmyBar
        v-if="game"
        :game="game"
        :hex="selected"
        :human-id="viewerId"
        :army="army"
        @army-change="onArmyChange"
      />
      <div v-if="game?.log?.length" class="log-panel">
        <div v-for="(entry, i) in game.log" :key="i" class="log-panel__entry">{{ entry }}</div>
      </div>
    </template>

    <div v-if="burgerOpen" class="burger-overlay" @click.self="burgerOpen = false">
      <div class="burger-menu">
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

.app__header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
}

.app__header h1 {
  margin: 0;
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

.menu__waiting {
  font-size: 18px;
  color: #ffd54f;
  margin: 0;
}

.menu__hint {
  color: #777;
  font-size: 12px;
  max-width: 360px;
  text-align: center;
}

.menu__google {
  margin-top: 6px;
  min-height: 40px;
}

.menu__auth {
  color: #ce93d8;
  font-weight: 600;
}

.banner {
  padding: 8px 20px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-weight: 600;
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
