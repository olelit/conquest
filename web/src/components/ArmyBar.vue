<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import type { GameState } from '../types';

const props = defineProps<{ game: GameState; humanId: number | null; army: number }>();

const emit = defineEmits<{ armyChange: [percent: number] }>();

const human = computed(() => props.game.players.find((p) => p.id === props.humanId) ?? null);
const points = computed(() => human.value?.points ?? 0);
const reserve = computed(() => Math.floor((points.value * props.army) / 100));
const available = computed(() => Math.max(0, points.value - reserve.value));
const limit = computed(() => human.value?.limit ?? 0);

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(Number.isFinite(value) ? value : 0)));
}

function change(value: number): void {
  emit('armyChange', clamp(value));
}

function step(delta: number): void {
  change(props.army + delta);
}
</script>

<template>
  <div class="army-bar">
    <div class="army-bar__row">
      <span class="army-bar__label">{{ t('army.label') }}</span>
      <button class="army-bar__btn" @click="step(-5)">−</button>
      <div class="army-bar__input-wrap">
        <input
          class="army-bar__input"
          type="number"
          min="0"
          max="100"
          :value="army"
          @change="change(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="army-bar__percent">%</span>
      </div>
      <button class="army-bar__btn" @click="step(5)">+</button>
      <span class="army-bar__hint">{{ t('army.hint', { available, limit }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.army-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid #555;
  border-radius: 10px;
  padding: 10px 18px;
  z-index: 30;
  min-width: 380px;
}

.army-bar__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.army-bar__label {
  font-weight: 700;
  color: #ffd54f;
  text-transform: uppercase;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.army-bar__btn {
  width: 32px;
  height: 32px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a31;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.army-bar__btn:hover {
  background: #3a3a44;
}

.army-bar__input {
  width: 90px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #555;
  background: #2a2a31;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.army-bar__hint {
  color: #999;
  font-size: 12px;
  white-space: nowrap;
}

.army-bar__input-wrap {
  position: relative;
}

.army-bar__percent {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #999;
  font-weight: 600;
  pointer-events: none;
}
</style>
