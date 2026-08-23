<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ArmyBar from './components/ArmyBar.vue';
import ContextMenu from './components/ContextMenu.vue';
import FpsOverlay from './components/FpsOverlay.vue';
import HexMap from './components/HexMap.vue';
import Hud from './components/Hud.vue';
import { GameClient } from './api';
import { adminDumpRoom, adminMe } from './admin';
import { t, lang, setLang } from './i18n';
import { STAGE_ORDER, continueTutorial, initTraining, observeTraining, stopTraining, taskDone, trainingStage, type TrainingStage } from './training';
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
const screen = ref<'menu' | 'ai' | 'lobby' | 'loadtest'>('menu');
const burgerOpen = ref(false);
const army = ref(20);
const contextMenu = ref<{
  hex: Hex;
  x: number;
  y: number;
  relation: 'peace' | 'war' | 'alliance';
  pendingFromOwner: { kind: 'peace' | 'alliance' } | null;
} | null>(null);
const hexMapRef = ref<InstanceType<typeof HexMap> | null>(null);
let suppressNextHexClick = false;
const aiMapType = ref<MapType>('normal');
const aiCount = ref(1);
const aiDifficulty = ref<Difficulty>('medium');
const createMapType = ref<MapType>('normal');
const createMaxPlayers = ref(5);
const loadTestPlayers = ref(10);
const victoryDismissed = ref(false);
const isAdmin = ref(false);
const dumpMsg = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);
const googleMsg = ref<string | null>(null);

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
const showVictoryModal = computed(() => {
  const g = game.value;
  return (
    g !== null &&
    g.winnerId === null &&
    g.majorityHolderId !== null &&
    g.majorityHolderId === playerId.value &&
    !victoryDismissed.value
  );
});
const STAGE_META: Record<TrainingStage, { titleKey: string; hintKey: string }> = {
  capture: { titleKey: 'training.captureTitle', hintKey: 'training.captureHint' },
  attack: { titleKey: 'training.attackTitle', hintKey: 'training.attackHint' },
  defend: { titleKey: 'training.defendTitle', hintKey: 'training.defendHint' },
  fortress: { titleKey: 'training.fortressTitle', hintKey: 'training.fortressHint' },
  diplomacy: { titleKey: 'training.diplomacyTitle', hintKey: 'training.diplomacyHint' },
  done: { titleKey: 'training.doneTitle', hintKey: 'training.doneHint' },
};
const trainingIndex = computed(() => (trainingStage.value === null ? 0 : STAGE_ORDER.indexOf(trainingStage.value) + 1));
const trainingTitleKey = computed(() => (trainingStage.value ? STAGE_META[trainingStage.value].titleKey : ''));
const trainingHintKey = computed(() => (trainingStage.value ? STAGE_META[trainingStage.value].hintKey : ''));
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
  () => room.value?.id,
  () => {
    closeContextMenu();
    victoryDismissed.value = false;
  },
);

watch(
  () => game.value?.majorityHolderId,
  (v) => {
    if (v === null) victoryDismissed.value = false;
  },
);

watch(
  () => room.value?.status,
  () => closeContextMenu(),
);

watch(
  () => burgerOpen.value,
  (open) => {
    if (open) {
      adminMe().then((m) => {
        isAdmin.value = m.authenticated;
      });
    }
  },
);

onMounted(() => {
  adminMe().then((m) => {
    isAdmin.value = m.authenticated;
  });
});

function trainingCtl(): { sendPause: () => void; isPaused: () => boolean } {
  return { sendPause: () => client.sendPause(), isPaused: () => room.value?.paused ?? false };
}

watch(
  () => room.value,
  (r) => {
    if (!r || !r.training) {
      stopTraining();
      return;
    }
    if (r.training && r.status === 'playing' && r.game && trainingStage.value === null && sessionStorage.getItem('conquest.training') === '1') {
      sessionStorage.removeItem('conquest.training');
      initTraining(trainingCtl());
    }
  },
);

watch(
  () => room.value?.game,
  (g) => {
    if (!g) return;
    if (trainingStage.value !== null && playerId.value !== null) {
      observeTraining(g, playerId.value);
      if (g.winnerId !== null || (g.players.find((p) => p.id === playerId.value)?.eliminated ?? false)) {
        stopTraining();
      }
    }
  },
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
  const relation: 'peace' | 'war' | 'alliance' = owner.id === playerId.value ? 'peace' : (owner.relation as 'peace' | 'war' | 'alliance');
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

function onMenuBuildFortress(): void {
  if (!contextMenu.value) return;
  client.sendBuildFortress(contextMenu.value.hex.q, contextMenu.value.hex.r);
  closeContextMenu();
}

function onMenuRemoveFortress(): void {
  if (!contextMenu.value) return;
  client.sendRemoveFortress(contextMenu.value.hex.q, contextMenu.value.hex.r);
  closeContextMenu();
}

function fortressCountOf(playerId: number | null): number {
  if (playerId === null || !game.value) return 0;
  return game.value.hexes.filter((h) => h.ownerId === playerId && h.fortress).length;
}

function closeContextMenu(): void {
  contextMenu.value = null;
}

function onHotkey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
  if (e.code === 'Escape') {
    closeContextMenu();
    burgerOpen.value = false;
    return;
  }
  if (!room.value || !game.value) return;
  if (e.code.startsWith('Digit')) {
    const digit = Number(e.code.slice(5));
    if (!Number.isNaN(digit)) {
      army.value = digit === 0 ? 100 : digit * 10;
    }
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    hexMapRef.value?.resetView();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (showPause.value) onPause();
  }
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

function onEndGame(): void {
  client.sendEndGame();
}

function onRestart(): void {
  if (!window.confirm(t('confirm.restart'))) return;
  burgerOpen.value = false;
  client.sendRestart();
  if (room.value?.training) {
    initTraining(trainingCtl());
  }
}

async function onExportGame(): Promise<void> {
  if (!room.value) return;
  const result = await adminDumpRoom(room.value.id);
  if (result.ok) {
    dumpMsg.value = { kind: 'ok', text: t('dump.saved', { id: result.id }) };
  } else {
    dumpMsg.value = { kind: 'err', text: t('dump.failed', { error: result.error }) };
  }
  window.setTimeout(() => {
    dumpMsg.value = null;
  }, 6000);
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

function goToLoadTest(): void {
  screen.value = 'loadtest';
}

function startLoadTest(): void {
  client.sendStartLoadTest(loadTestPlayers.value);
}

function startSolo(): void {
  client.sendStartSolo(aiMapType.value, aiCount.value, aiDifficulty.value);
}

function startTutorial(): void {
  sessionStorage.setItem('conquest.training', '1');
  client.sendStartSolo('normal', 1, 'easy', true);
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
  if (!window.confirm(t('confirm.leave'))) return;
  burgerOpen.value = false;
  client.sendToMenu();
}

function onGoogleNotConfigured(): void {
  googleMsg.value = t('menu.googleNotConfigured');
  window.setTimeout(() => {
    googleMsg.value = null;
  }, 4000);
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
  window.addEventListener('keydown', onHotkey);
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
  window.removeEventListener('keydown', onHotkey);
  window.removeEventListener('blur', closeContextMenu);
  window.removeEventListener('contextmenu', onMenuContextMenu);
});
</script>

<template>
  <main class="app">
    <template v-if="screen === 'menu' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.subtitle') }}</p>
        <button class="menu__btn" :disabled="!connected" @click="goToAi">{{ t('menu.playVsAi') }}</button>
        <button class="menu__btn" :disabled="!connected" @click="startTutorial">{{ t('menu.tutorial') }}</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLobby">{{ t('menu.playVsHumans') }}</button>
        <button class="menu__btn" :disabled="!connected" @click="goToLoadTest">{{ t('menu.loadTest') }}</button>
        <div class="menu__google">
          <div v-if="auth" class="menu__auth">{{ t('menu.loggedInAs', { name: auth.name }) }}</div>
          <div v-else-if="GOOGLE_CLIENT_ID" id="google-btn"></div>
          <button v-else class="menu__btn menu__btn--ghost" @click="onGoogleNotConfigured">{{ t('menu.signInGoogle') }}</button>
          <div v-if="googleMsg" class="menu__google-err">{{ googleMsg }}</div>
        </div>
        <div class="menu__lang">
          <button class="menu__lang-btn" :class="{ 'is-active': lang === 'en' }" @click="setLang('en')">EN</button>
          <button class="menu__lang-btn" :class="{ 'is-active': lang === 'ru' }" @click="setLang('ru')">RU</button>
        </div>
      </div>
    </template>

    <template v-else-if="screen === 'ai' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.aiSubtitle') }}</p>
        <select v-model="aiMapType" class="menu__select">
          <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
            {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
          </option>
        </select>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.aiCount') }}</span>
          <select v-model.number="aiCount" class="menu__select">
            <option v-for="n in aiMax" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.difficulty') }}</span>
          <select v-model="aiDifficulty" class="menu__select">
            <option value="easy">{{ t('difficulty.easy') }}</option>
            <option value="medium">{{ t('difficulty.medium') }}</option>
            <option value="hard">{{ t('difficulty.hard') }}</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startSolo">{{ t('menu.startGame') }}</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="screen === 'lobby' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.lobbySubtitle') }}</p>
        <div class="lobby">
          <div v-for="r in rooms" :key="r.id" class="lobby__room" @click="joinRoom(r.id)">
            <span class="lobby__name">{{ r.name }}</span>
            <span class="lobby__map">{{ t(MAP_INFO[r.mapType].labelKey) }}</span>
            <span class="lobby__players">{{ r.humans }}/{{ r.maxPlayers }}</span>
          </div>
          <div v-if="rooms.length === 0" class="lobby__empty">{{ t('menu.noRooms') }}</div>
        </div>
        <div class="lobby__create">
          <h3 class="lobby__create-title">{{ t('menu.createRoom') }}</h3>
          <select v-model="createMapType" class="menu__select">
            <option v-for="(info, type) in MAP_INFO" :key="type" :value="type">
              {{ t(info.labelKey) }} — {{ t(info.descriptionKey) }}
            </option>
          </select>
          <select v-model.number="createMaxPlayers" class="menu__select">
            <option v-for="n in createOptions" :key="n" :value="n">{{ t('menu.playersN', { n }) }}</option>
          </select>
          <button class="menu__btn" :disabled="!connected" @click="createRoom">{{ t('menu.create') }}</button>
        </div>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="screen === 'loadtest' && !room">
      <div class="menu">
        <h1 class="menu__title">Conquest</h1>
        <p class="menu__subtitle">{{ t('menu.loadTestSubtitle') }}</p>
        <div class="menu__row">
          <span class="menu__label">{{ t('menu.players') }}</span>
          <select v-model.number="loadTestPlayers" class="menu__select">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="30">30</option>
          </select>
        </div>
        <button class="menu__btn" :disabled="!connected" @click="startLoadTest">{{ t('menu.runTest') }}</button>
        <button class="menu__btn menu__btn--ghost" @click="goToMenu">{{ t('menu.back') }}</button>
      </div>
    </template>

    <template v-else-if="room && room.status === 'waiting'">
      <div class="menu">
        <h1 class="menu__title">{{ room.name }}</h1>
        <p class="menu__subtitle">
          {{ t('menu.mapNPlayers', { map: t(MAP_INFO[room.mapType].labelKey), slots: room.slots.length, max: room.maxPlayers }) }}
        </p>
        <div class="lobby">
          <div v-for="s in room.slots" :key="s.id" class="lobby__room">
            <span class="lobby__name">{{ s.name }}</span>
            <span v-if="s.id === room.hostPlayerId" class="lobby__host">{{ t('menu.host') }}</span>
          </div>
          <div v-if="room.maxPlayers - room.slots.length > 0" class="lobby__empty">
            {{ t('menu.freeSlots', { n: room.maxPlayers - room.slots.length }) }}
          </div>
        </div>
        <button v-if="isHost" class="menu__btn" :disabled="!connected" @click="startRoom">{{ t('menu.startGame') }}</button>
        <p v-else class="menu__waiting">{{ t('menu.waitingHost') }}</p>
        <button class="menu__btn menu__btn--ghost" @click="leaveRoom">{{ t('menu.leaveRoom') }}</button>
      </div>
    </template>

    <template v-else-if="room && game">
      <div class="game-screen">
        <div class="app__header">
          <h1>{{ room.name }}</h1>
          <div class="app__controls">
            <span v-if="room?.training" class="training-badge">{{ t('training.badge') }}</span>
            <button v-if="showPause" class="app__btn" :disabled="!connected" @click="onPause" :title="room.paused ? t('menu.resume') : t('menu.pause')">
              {{ room.paused ? '▶' : '⏸' }}
            </button>
            <button class="app__btn app__burger" @click="burgerOpen = !burgerOpen">☰</button>
          </div>
        </div>
        <div v-if="winner && defeated" class="banner banner--error banner--center">{{ t('banner.defeat', { name: winner }) }}</div>
        <div v-else-if="winner" class="banner banner--win banner--center">{{ t('banner.victory', { name: winner }) }}</div>
        <div v-else-if="!connected" class="banner banner--warn">{{ t('banner.connecting') }}</div>
        <div v-if="error" class="banner banner--error">{{ error }}</div>
        <div v-if="dumpMsg" class="banner" :class="dumpMsg.kind === 'ok' ? 'banner--warn' : 'banner--error'">{{ dumpMsg.text }}</div>
        <div v-if="winner && isAdmin" class="export-overlay">
          <button class="export-overlay__btn" @click="onExportGame">{{ t('dump.export') }}</button>
        </div>
        <div v-if="showVictoryModal" class="victory-modal">
          <div class="victory-modal__card">
            <div class="victory-modal__title">{{ t('victory.title') }}</div>
            <div class="victory-modal__actions">
              <button class="victory-modal__btn" @click="onEndGame">{{ t('victory.endGame') }}</button>
              <button class="victory-modal__btn victory-modal__btn--ghost" @click="victoryDismissed = true">{{ t('victory.keepPlaying') }}</button>
            </div>
          </div>
        </div>
        <div v-if="trainingStage && !winner && !defeated" class="training-overlay">
          <div class="training-card">
            <div class="training-card__title">{{ t('training.stageN', { n: trainingIndex, name: t(trainingTitleKey) }) }}</div>
            <div class="training-card__hint">{{ t(trainingHintKey) }}</div>
            <button v-if="taskDone" class="training-card__ok" @click="continueTutorial">{{ t('training.ok') }}</button>
          </div>
        </div>
        <Hud v-if="game && !room.loadTest" :game="game" :human-id="playerId" :army="army" />
        <FpsOverlay v-if="room.loadTest" />
        <div v-if="room && game && !room.loadTest" class="hotkeys-hint">{{ t('hotkeys.hint') }}</div>
        <HexMap
          ref="hexMapRef"
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
          :hex-count="myPlayer?.hexCount ?? 0"
          :fortress-count="fortressCountOf(myPlayer?.id ?? null)"
          :points="myPlayer?.points ?? 0"
          @close="closeContextMenu"
          @declare-war="onMenuDeclareWar"
          @propose="onMenuPropose"
          @respond="onMenuRespond"
          @build-fortress="onMenuBuildFortress"
          @remove-fortress="onMenuRemoveFortress"
        />
        <ArmyBar v-if="game && !room.loadTest" :game="game" :human-id="playerId" :army="army" @army-change="onArmyChange" />
        <div v-if="room.log?.length && !room.loadTest" class="log-panel">
          <div v-for="(entry, i) in room.log" :key="i" class="log-panel__entry" :class="`log-panel__entry--${entry.kind}`">{{ entry.text }}</div>
        </div>
      </div>
    </template>

    <div v-if="burgerOpen" class="burger-overlay" @click.self="burgerOpen = false">
      <div class="burger-menu">
        <button v-if="room?.aiMode" class="burger-menu__item" @click="onRestart">{{ t('burger.restart') }}</button>
        <button class="burger-menu__item" @click="onToMenu">{{ t('burger.toMenu') }}</button>
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

.hotkeys-hint {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 15;
  color: #666;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 6px;
  padding: 4px 10px;
  pointer-events: none;
  white-space: nowrap;
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

.menu__lang {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.menu__lang-btn {
  padding: 6px 14px;
  border: 1px solid #888;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
}
.menu__lang-btn.is-active {
  background: #888;
  color: #fff;
}

.training-badge {
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  font-size: 12px;
  font-weight: 600;
}
.training-overlay {
  position: fixed;
  top: 90px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 14px 20px;
  background: rgba(30, 30, 30, 0.92);
  color: #fff;
  border-radius: 10px;
  border: 1px solid #888;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  max-width: 480px;
  text-align: center;
}
.training-card__title {
  font-weight: 700;
  margin-bottom: 6px;
}
.training-card__hint {
  font-size: 14px;
  line-height: 1.4;
  margin-bottom: 10px;
}
.training-card__ok {
  padding: 6px 24px;
  border: none;
  border-radius: 6px;
  background: #4caf50;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.training-card__ok:hover {
  background: #43a047;
}

.menu__google {
  margin-top: 6px;
  min-height: 40px;
}

.menu__auth {
  color: #ce93d8;
  font-weight: 600;
}

.menu__google-err {
  color: #ff6b6b;
  font-size: 13px;
  margin-top: 6px;
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

.victory-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 70;
}

.export-overlay {
  position: fixed;
  top: calc(50% + 64px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
}

.export-overlay__btn {
  padding: 10px 22px;
  border: none;
  border-radius: 8px;
  background: #2196f3;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}

.export-overlay__btn:hover {
  background: #1976d2;
}

.victory-modal__card {
  background: rgba(20, 20, 26, 0.96);
  border: 1px solid #888;
  border-radius: 12px;
  padding: 26px 34px;
  text-align: center;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.6);
}

.victory-modal__title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 18px;
}

.victory-modal__actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.victory-modal__btn {
  padding: 10px 22px;
  border: none;
  border-radius: 8px;
  background: #2e7d32;
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}

.victory-modal__btn--ghost {
  background: transparent;
  border: 1px solid #888;
  color: inherit;
}

.victory-modal__btn:hover {
  filter: brightness(1.15);
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
  font-size: 14px;
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

.log-panel__entry--war {
  color: #ff6b6b;
}

.log-panel__entry--diplomacy {
  color: #69db7c;
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
