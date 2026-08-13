<script setup lang="ts">
import { computed } from 'vue';
import type { Hex, Player } from '../types';

const props = defineProps<{ hex: Hex; x: number; y: number; players: Player[]; humanId: number | null }>();

const emit = defineEmits<{ close: [] }>();

const isMine = computed(() => props.hex.ownerId !== null && props.hex.ownerId === props.humanId);
const isEnemy = computed(() => props.hex.ownerId !== null && props.hex.ownerId !== props.humanId);

const items = computed(() => {
  if (isMine.value) {
    return [{ label: 'Построить крепость', disabled: true, hint: 'будет доступно позже' }];
  }
  if (isEnemy.value) {
    return [
      { label: 'Война', disabled: true, hint: 'будет доступно позже' },
      { label: 'Мир', disabled: true, hint: 'будет доступно позже' },
      { label: 'Союз', disabled: true, hint: 'будет доступно позже' },
    ];
  }
  return [];
});

const style = computed(() => {
  const margin = 8;
  const left = Math.min(props.x, window.innerWidth - 220 - margin);
  const top = Math.min(props.y, window.innerHeight - items.value.length * 38 - 24 - margin);
  return { left: `${Math.max(margin, left)}px`, top: `${Math.max(margin, top)}px` };
});

function pick(): void {
  emit('close');
}
</script>

<template>
  <div class="context-menu" :style="style" @mousedown.stop @contextmenu.prevent="pick">
    <button
      v-for="item in items"
      :key="item.label"
      class="context-menu__item"
      :disabled="item.disabled"
      :title="item.disabled ? item.hint : undefined"
      @click="pick"
    >
      <span>{{ item.label }}</span>
      <span v-if="item.disabled" class="context-menu__hint">{{ item.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  min-width: 210px;
  background: rgba(20, 20, 26, 0.96);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
}

.context-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.context-menu__item:not(:disabled):hover {
  background: #3a3a44;
}

.context-menu__item:disabled {
  color: #777;
  cursor: default;
}

.context-menu__hint {
  font-size: 11px;
  font-weight: 400;
  color: #666;
  white-space: nowrap;
}
</style>
