<script setup lang="ts">
import { computed } from 'vue';
import { playerColor, type GameState, type Player } from '../types';

const props = defineProps<{ game: GameState; humanId: number | null; army: number }>();

const players = computed(() => {
  if (props.humanId === null) return props.game.players;
  const me = props.game.players.find((p) => p.id === props.humanId);
  const others = props.game.players.filter((p) => p.id !== props.humanId);
  return me ? [me, ...others] : props.game.players;
});

function colorOf(p: Player): string {
  return playerColor(p.id);
}

function pointsText(p: Player): string {
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
      :class="{ 'player-list__row--me': p.id === humanId }"
    >
      <span class="player-list__name" :style="{ color: colorOf(p) }">{{ p.name }}</span>
      <span class="player-list__hexes">{{ p.hexCount }} кл.</span>
      <span class="player-list__points">{{ pointsText(p) }}</span>
      <span class="player-list__income">+{{ p.income }}/сек</span>
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

.player-list__name {
  font-weight: 700;
  font-size: 20px;
  white-space: nowrap;
}

.player-list__hexes {
  color: #aaa;
  font-size: 14px;
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
