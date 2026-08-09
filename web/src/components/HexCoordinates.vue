<script setup lang="ts">
import { TERRAIN_LABELS, type Hex } from '../types';

defineProps<{ hex: Hex }>();
</script>

<template>
  <div class="hex-coordinates">
    q: {{ hex.q }}, r: {{ hex.r }} — {{ TERRAIN_LABELS[hex.terrain] }}
  </div>
</template>

<style scoped>
.hex-coordinates {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 10;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-family: monospace;
  font-size: 14px;
}
</style>
