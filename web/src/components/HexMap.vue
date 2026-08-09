<script setup lang="ts">
import { computed, ref } from 'vue';
import HexCoordinates from './HexCoordinates.vue';
import { TERRAIN_COLORS, type Hex } from '../types';

const props = defineProps<{ hexes: Hex[] }>();

const HEX_SIZE = 30;
const SQRT3 = Math.sqrt(3);
const PADDING = 20;

const hovered = ref<Hex | null>(null);

function hexCenter(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexPoints(q: number, r: number): string {
  const { x, y } = hexCenter(q, r);
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(`${(x + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(y + HEX_SIZE * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
}

const viewBox = computed(() => {
  const xs = props.hexes.map((h) => hexCenter(h.q, h.r).x);
  const ys = props.hexes.map((h) => hexCenter(h.q, h.r).y);
  const minX = Math.min(...xs) - HEX_SIZE - PADDING;
  const maxX = Math.max(...xs) + HEX_SIZE + PADDING;
  const minY = Math.min(...ys) - HEX_SIZE - PADDING;
  const maxY = Math.max(...ys) + HEX_SIZE + PADDING;
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
});
</script>

<template>
  <div class="hex-map">
    <svg :viewBox="viewBox" class="hex-map__svg">
      <polygon
        v-for="hex in props.hexes"
        :key="`${hex.q},${hex.r}`"
        :points="hexPoints(hex.q, hex.r)"
        :fill="TERRAIN_COLORS[hex.terrain]"
        class="hex"
        @mousemove="hovered = hex"
        @mouseleave="hovered = null"
      />
    </svg>
    <HexCoordinates v-if="hovered" :hex="hovered" />
  </div>
</template>

<style scoped>
.hex-map {
  width: 100%;
  max-width: 1100px;
}

.hex-map__svg {
  display: block;
  width: 100%;
  height: auto;
}

.hex {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  cursor: pointer;
  transition:
    stroke-width 0.12s ease,
    filter 0.12s ease;
}

.hex:hover {
  stroke: #ffd54f;
  stroke-width: 3.5;
  filter: brightness(1.18);
}
</style>
