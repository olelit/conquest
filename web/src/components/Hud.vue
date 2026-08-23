<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { playerPalette, type GameState, type Player } from '../types';

const props = defineProps<{ game: GameState; humanId: number | null; army: number }>();

const palette = computed(() => playerPalette(props.game.players.map((p) => p.id)));

const players = computed(() => {
  if (props.humanId === null) return props.game.players;
  const me = props.game.players.find((p) => p.id === props.humanId);
  const others = props.game.players.filter((p) => p.id !== props.humanId);
  return me ? [me, ...others] : props.game.players;
});

function colorOf(p: Player): string {
  return palette.value.get(p.id) ?? '#607d8b';
}

function pointsText(p: Player): string {
  if (p.points === null) return '?';
  if (p.id === props.humanId) {
    const reserve = Math.floor((p.points * props.army) / 100);
    return `${Math.max(0, p.points - reserve)}/${p.limit}`;
  }
  return `${p.points}/${p.limit}`;
}
</script>

<template>
  <div class="player-list">
    <div
      v-for="p in players"
      :key="p.id"
      class="player-list__row"
      :class="{
        'player-list__row--me': p.id === humanId,
        'player-list__row--dead': p.eliminated,
        'player-list__row--ally': p.relation === 'alliance',
      }"
    >
      <span class="player-list__name" :style="{ color: colorOf(p) }">{{ p.name }}</span>
      <span class="player-list__hexes">{{ t('hud.hexes', { n: p.hexCount }) }}</span>
      <span v-if="p.eliminated" class="player-list__dead">{{ t('hud.eliminated') }}</span>
      <span class="player-list__points">{{ pointsText(p) }}</span>
      <span v-if="p.income !== null" class="player-list__income">+{{ p.income }}{{ t('hud.perSec') }}</span>
    </div>
  </div>
</template>

<style scoped>
.player-list {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 20;
  min-width: 300px;
}

.player-list__row {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid #555;
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 18px;
}

.player-list__row--me {
  border-color: #888;
  border-width: 2px;
}

.player-list__row--ally {
  border-color: #7cb342;
}

.player-list__row--dead {
  opacity: 0.45;
}

.player-list__name {
  font-weight: 700;
  font-size: 20px;
  white-space: nowrap;
}

.player-list__hexes {
  color: #aaa;
  font-size: 14px;
}

.player-list__dead {
  color: #c62828;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

.player-list__points {
  font-weight: 700;
  font-size: 20px;
  color: #fff;
  margin-left: auto;
}

.player-list__income {
  color: #7cb342;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
