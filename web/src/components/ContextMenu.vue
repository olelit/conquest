<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import type { Hex, Player } from '../types';

const props = defineProps<{
  hex: Hex;
  x: number;
  y: number;
  players: Player[];
  humanId: number | null;
  relation: 'peace' | 'war' | 'alliance';
  pendingFromOwner: { kind: 'peace' | 'alliance' } | null;
  hexCount: number;
  fortressCount: number;
  points: number;
}>();

const emit = defineEmits<{
  close: [];
  declareWar: [];
  propose: [kind: 'peace' | 'alliance'];
  respond: [accept: boolean];
  buildFortress: [];
  removeFortress: [];
}>();

const isMine = computed(() => props.hex.ownerId !== null && props.hex.ownerId === props.humanId);
const isEnemy = computed(() => props.hex.ownerId !== null && props.hex.ownerId !== props.humanId);

const canBuildFortress = computed(() => {
  if (props.hex.attackerId !== null) return false;
  const limit = Math.floor(props.hexCount / 15);
  const nextLimit = 1000 + props.hexCount * 50 - 100 * (props.fortressCount + 1);
  return limit > props.fortressCount && props.points <= nextLimit;
});

const items = computed(() => {
  if (isMine.value) {
    if (props.hex.fortress) {
      return [{ label: t('cm.removeFortress'), disabled: false, hint: '', action: 'remove-fortress' }];
    }
    return [
      { label: t('cm.buildFortress'), disabled: !canBuildFortress.value, hint: canBuildFortress.value ? '' : t('cm.fortressHint'), action: 'build-fortress' },
    ];
  }
  if (isEnemy.value) {
    if (props.pendingFromOwner) {
      return [
        { label: props.pendingFromOwner.kind === 'peace' ? t('cm.acceptPeace') : t('cm.acceptAlliance'), disabled: false, hint: '', action: 'respond-true' },
        { label: t('cm.decline'), disabled: false, hint: '', action: 'respond-false' },
      ];
    }
    if (props.relation === 'peace') {
      return [
        { label: t('cm.war'), disabled: false, hint: '', action: 'war' },
        { label: t('cm.peace'), disabled: true, hint: t('cm.alreadyPeace'), action: '' },
        { label: t('cm.alliance'), disabled: false, hint: '', action: 'alliance' },
      ];
    }
    if (props.relation === 'war') {
      return [
        { label: t('cm.war'), disabled: true, hint: t('cm.alreadyWar'), action: '' },
        { label: t('cm.peace'), disabled: false, hint: '', action: 'peace' },
        { label: t('cm.alliance'), disabled: true, hint: t('cm.notInWar'), action: '' },
      ];
    }
    return [
      { label: t('cm.war'), disabled: false, hint: '', action: 'war' },
      { label: t('cm.peace'), disabled: true, hint: t('cm.allies'), action: '' },
      { label: t('cm.alliance'), disabled: true, hint: t('cm.alreadyAlliance'), action: '' },
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

function pick(action: string): void {
  if (action === 'war') emit('declareWar');
  else if (action === 'peace' || action === 'alliance') emit('propose', action);
  else if (action === 'respond-true') emit('respond', true);
  else if (action === 'respond-false') emit('respond', false);
  else if (action === 'build-fortress') emit('buildFortress');
  else if (action === 'remove-fortress') emit('removeFortress');
  emit('close');
}
</script>

<template>
  <div class="context-menu" :style="style" @mousedown.stop @contextmenu.prevent="emit('close')">
    <button
      v-for="item in items"
      :key="item.label"
      class="context-menu__item"
      :disabled="item.disabled"
      :title="item.disabled ? item.hint : undefined"
      @click="pick(item.action)"
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
