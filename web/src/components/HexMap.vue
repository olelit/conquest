<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { playerColor, TERRAIN_COLORS, TERRAIN_COSTS, TERRAIN_LABELS, type Hex, type Player } from '../types';

const props = defineProps<{ hexes: Hex[]; players: Player[]; captureTicks: number }>();

const emit = defineEmits<{ click: [hex: Hex] }>();

const HEX_SIZE = 30;
const SQRT3 = Math.sqrt(3);
const PADDING = 20;
// Невидимая зона вокруг карты: её можно двигать, даже когда зум отсутствует,
// чтобы увести край карты из-под интерфейса.
const PAN_MARGIN = 0.5;

const pointCache = new Map<string, ReturnType<typeof hexPoints>>();

function hexCenter(q: number, r: number): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (q + r / 2),
    y: HEX_SIZE * (3 / 2) * r,
  };
}

function hexPoints(q: number, r: number): { points: string; minX: number; minY: number; maxX: number; maxY: number } {
  const key = `${q},${r}`;
  const cached = pointCache.get(key);
  if (cached) return cached;
  const { x, y } = hexCenter(q, r);
  const pts: string[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + HEX_SIZE * Math.cos(angle);
    const py = y + HEX_SIZE * Math.sin(angle);
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const result = { points: pts.join(' '), minX, minY, maxX, maxY };
  pointCache.set(key, result);
  return result;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const baseViewBox = computed<ViewBox>(() => {
  const xs = props.hexes.map((h) => hexCenter(h.q, h.r).x);
  const ys = props.hexes.map((h) => hexCenter(h.q, h.r).y);
  const minX = Math.min(...xs) - HEX_SIZE - PADDING;
  const maxX = Math.max(...xs) + HEX_SIZE + PADDING;
  const minY = Math.min(...ys) - HEX_SIZE - PADDING;
  const maxY = Math.max(...ys) + HEX_SIZE + PADDING;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
});

const view = ref<ViewBox | null>(null);
const viewBox = computed(() => `${baseViewBox.value.x} ${baseViewBox.value.y} ${baseViewBox.value.w} ${baseViewBox.value.h}`);
const viewTransform = computed(() => {
  const base = baseViewBox.value;
  const v = view.value ?? base;
  const scale = base.w / v.w;
  // привязка сдвига к целым пикселям экрана: убирает субпиксельное «дрожание»
  // граней гексов на больших картах (композитинг без пересэмплинга)
  const pxPerUnit = mapWrap.value ? mapWrap.value.clientWidth / base.w : 1;
  const tx = Math.round((base.x - v.x * scale) * pxPerUnit) / pxPerUnit;
  const ty = Math.round((base.y - v.y * scale) * pxPerUnit) / pxPerUnit;
  return `translate(${tx} ${ty}) scale(${scale})`;
});

watch(baseViewBox, (b) => {
  if (view.value === null) view.value = { ...b };
});

const mapWrap = ref<HTMLDivElement | null>(null);

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const base = baseViewBox.value;
  const el = mapWrap.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const cx = (e.clientX - rect.left) / rect.width;
  const cy = (e.clientY - rect.top) / rect.height;
  const v = view.value ?? base;
  const worldX = v.x + cx * v.w;
  const worldY = v.y + cy * v.h;
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const minW = base.w / 3;
  const maxW = base.w / 0.5;
  const newW = Math.min(maxW, Math.max(minW, v.w / factor));
  if (Math.abs(newW - v.w) < 0.001) return;
  const newH = newW * (base.h / base.w);
  view.value = clampView({
    x: worldX - cx * newW,
    y: worldY - cy * newH,
    w: newW,
    h: newH,
  });
}

const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
const pressedKeys = new Set<string>();
let panRaf = 0;
let lastPanTime = 0;

function onKeyDown(e: KeyboardEvent): void {
  if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
  if (!PAN_KEYS.has(e.code)) return;
  e.preventDefault();
  pressedKeys.add(e.code);
  if (!panRaf) {
    lastPanTime = 0;
    panRaf = requestAnimationFrame(panStep);
  }
}

function onKeyUp(e: KeyboardEvent): void {
  pressedKeys.delete(e.code);
  if (pressedKeys.size === 0 && panRaf) {
    cancelAnimationFrame(panRaf);
    panRaf = 0;
  }
}

function onBlur(): void {
  pressedKeys.clear();
  if (panRaf) {
    cancelAnimationFrame(panRaf);
    panRaf = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampView(v: ViewBox): ViewBox {
  const base = baseViewBox.value;
  const marginW = base.w * PAN_MARGIN;
  const marginH = base.h * PAN_MARGIN;
  return {
    ...v,
    x: clamp(v.x, base.x - marginW - v.w, base.x + base.w + marginW),
    y: clamp(v.y, base.y - marginH - v.h, base.y + base.h + marginH),
  };
}

function panStep(now: number): void {
  const v = view.value ?? baseViewBox.value;
  if (!lastPanTime) lastPanTime = now;
  const dt = Math.min((now - lastPanTime) / 1000, 0.1);
  lastPanTime = now;
  let dx = 0;
  let dy = 0;
  const speed = v.w * 0.45;
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) dx -= 1;
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) dx += 1;
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) dy -= 1;
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) dy += 1;
  if (dx !== 0 || dy !== 0) {
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    view.value = clampView({ ...v, x: v.x + dx * speed * dt, y: v.y + dy * speed * dt });
  }
  panRaf = requestAnimationFrame(panStep);
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  if (panRaf) {
    cancelAnimationFrame(panRaf);
    panRaf = 0;
  }
});

const prevOwners = ref<Map<string, number | null>>(new Map());
const flashKeys = ref<Set<string>>(new Set());

watch(
  () => props.hexes,
  (hexes) => {
    const next = new Map<string, number | null>();
    for (const hex of hexes) {
      const key = `${hex.q},${hex.r}`;
      next.set(key, hex.ownerId);
      const prev = prevOwners.value.get(key);
      if (prev !== undefined && prev !== hex.ownerId && hex.ownerId !== null) {
        flashKeys.value = new Set(flashKeys.value).add(key);
        setTimeout(() => {
          const s = new Set(flashKeys.value);
          s.delete(key);
          flashKeys.value = s;
        }, 600);
      }
    }
    prevOwners.value = next;
  },
);

const hoveredPos = ref<{ q: number; r: number } | null>(null);
const hovered = computed(() => {
  if (!hoveredPos.value) return null;
  return props.hexes.find((h) => h.q === hoveredPos.value!.q && h.r === hoveredPos.value!.r) ?? null;
});

function colorOf(id: number | null): string {
  if (id === null) return '#999';
  return playerColor(id);
}

function playerName(id: number | null): string {
  if (id === null) return '—';
  return props.players.find((p) => p.id === id)?.name ?? `Игрок ${id}`;
}

function captureState(hex: Hex): { byId: number; progress: number } | null {
  if (hex.attackerId === null || hex.battleProgress === 0) return null;
  if (hex.battleProgress > 0) return { byId: hex.attackerId, progress: hex.battleProgress };
  if (hex.defenderId === null) return null;
  return { byId: hex.defenderId, progress: -hex.battleProgress };
}

function capitalPlayer(hex: Hex): Player | null {
  return props.players.find((p) => !p.eliminated && p.capital !== null && p.capital.q === hex.q && p.capital.r === hex.r) ?? null;
}

const tooltipPos = computed(() => {
  const hex = hovered.value;
  if (!hex) return null;
  const el = mapWrap.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const v = view.value ?? baseViewBox.value;
  const center = hexCenter(hex.q, hex.r);
  const left = ((center.x - v.x) / v.w) * rect.width;
  const top = ((center.y - v.y) / v.h) * rect.height;
  const clampedLeft = Math.min(Math.max(left, 75), Math.max(75, rect.width - 75));
  return { left: clampedLeft, top: Math.max(70, top) };
});

function terrainFill(hex: Hex): string {
  return TERRAIN_COLORS[hex.terrain];
}

function ownerStyle(hex: Hex): { fill: string; stroke: string } | null {
  if (hex.ownerId === null) return null;
  const color = colorOf(hex.ownerId);
  return { fill: color, stroke: color };
}

function battleOverlay(hex: Hex): { fill: string; y: number; height: number } | null {
  if (hex.attackerId === null) return null;
  const box = hexPoints(hex.q, hex.r);
  const total = hex.attackInvestment + hex.defenseInvestment;
  const share = total === 0 ? 0.5 : hex.attackInvestment / total;
  return { fill: colorOf(hex.attackerId), y: box.minY, height: (box.maxY - box.minY) * share };
}
</script>

<template>
  <div ref="mapWrap" class="hex-map" @contextmenu.prevent @wheel.prevent="onWheel">
    <svg :viewBox="viewBox" class="hex-map__svg">
      <g :transform="viewTransform" class="hex-map__view">
      <defs>
        <clipPath v-for="hex in props.hexes.filter((h) => h.attackerId !== null)" :key="`clip-${hex.q}-${hex.r}`" :id="`clip-${hex.q}-${hex.r}`">
          <rect
            v-if="battleOverlay(hex)"
            :x="hexPoints(hex.q, hex.r).minX"
            :y="battleOverlay(hex)!.y"
            :width="hexPoints(hex.q, hex.r).maxX - hexPoints(hex.q, hex.r).minX"
            :height="battleOverlay(hex)!.height"
          />
        </clipPath>
      </defs>
      <g
        v-for="hex in props.hexes"
        :key="`${hex.q},${hex.r}`"
        class="hex-group"
        @click="emit('click', hex)"
        @mouseenter="hoveredPos = { q: hex.q, r: hex.r }"
        @mouseleave="hoveredPos = null"
      >
        <polygon :points="hexPoints(hex.q, hex.r).points" :fill="terrainFill(hex)" class="hex" />
        <polygon
          v-if="ownerStyle(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :style="ownerStyle(hex)!"
          :class="{ 'hex-flash': flashKeys.has(hex.q + ',' + hex.r) }"
          class="hex-tint"
        />
        <text
          v-if="capitalPlayer(hex)"
          :x="hexCenter(hex.q, hex.r).x"
          :y="hexCenter(hex.q, hex.r).y + 11"
          text-anchor="middle"
          class="hex-capital"
        >★</text>
        <polygon
          v-if="battleOverlay(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :fill="battleOverlay(hex)!.fill"
          :clip-path="`url(#clip-${hex.q}-${hex.r})`"
          class="hex-battle"
        />
        <polygon
          v-if="captureState(hex)"
          :points="hexPoints(hex.q, hex.r).points"
          :stroke="colorOf(captureState(hex)!.byId)"
          class="hex-capture-ring"
        />
      </g>
      </g>
    </svg>

    <div
      v-if="tooltipPos && hovered"
      class="battle-tooltip"
      :style="{ left: tooltipPos.left + 'px', top: tooltipPos.top + 'px' }"
    >
      <div class="battle-tooltip__row">
        <span>{{ TERRAIN_LABELS[hovered.terrain] }}</span>
        <span class="battle-tooltip__pool">{{ TERRAIN_COSTS[hovered.terrain] }}</span>
      </div>
      <div class="battle-tooltip__row">
        <span>Владелец: {{ playerName(hovered.ownerId) }}{{ capitalPlayer(hovered) ? ' ★ столица' : '' }}</span>
      </div>
      <template v-if="hovered.attackerId !== null">
        <div class="battle-tooltip__row">
          <span class="battle-tooltip__name" :style="{ color: colorOf(hovered.attackerId) }">{{ playerName(hovered.attackerId) }}</span>
          <span class="battle-tooltip__pool">{{ hovered.attackInvestment }}</span>
        </div>
        <div class="battle-tooltip__row">
          <span class="battle-tooltip__name" :style="{ color: colorOf(hovered.defenderId) }">{{ playerName(hovered.defenderId) }}</span>
          <span class="battle-tooltip__pool">{{ hovered.defenseInvestment }}</span>
        </div>
        <div v-if="captureState(hovered)" class="battle-tooltip__capture">
          <div class="battle-tooltip__capture-label">
            Захват: {{ playerName(captureState(hovered)!.byId) }}
          </div>
          <div class="battle-tooltip__bar">
            <div
              class="battle-tooltip__bar-fill"
              :style="{ width: Math.min(100, (captureState(hovered)!.progress / props.captureTicks) * 100) + '%' }"
            ></div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hex-map {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
}

.hex-map__svg {
  display: block;
  width: 100%;
  height: auto;
}

.hex-map__view {
  will-change: transform;
}

.hex {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  cursor: pointer;
  transition:
    stroke-width 0.12s ease,
    filter 0.12s ease;
}

.hex-group:hover .hex {
  stroke: #ffd54f;
  stroke-width: 3.5;
  filter: brightness(1.18);
}

.hex-tint {
  fill-opacity: 0.5;
  stroke-opacity: 1;
  stroke-width: 3.5;
  pointer-events: none;
}

.hex-group:hover .hex-tint {
  fill-opacity: 0.65;
  stroke-width: 4.5;
}

.hex-battle {
  stroke: #1a1a1a;
  stroke-width: 1.5;
  opacity: 0.55;
  pointer-events: none;
}

.hex-capture-ring {
  fill: none;
  stroke-width: 3;
  pointer-events: none;
}

.hex-capital {
  font-size: 26px;
  fill: #ffd54f;
  stroke: #1a1a1a;
  stroke-width: 1.5;
  pointer-events: none;
}

.battle-tooltip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  background: rgba(20, 20, 26, 0.94);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: #fff;
  pointer-events: none;
  white-space: nowrap;
  z-index: 50;
}

.battle-tooltip__row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  line-height: 1.5;
}

.battle-tooltip__pool {
  font-family: monospace;
  font-weight: 700;
}

.battle-tooltip__capture {
  margin-top: 6px;
}

.battle-tooltip__capture-label {
  font-size: 11px;
  color: #ffd54f;
  margin-bottom: 3px;
}

.battle-tooltip__bar {
  width: 120px;
  height: 6px;
  border-radius: 3px;
  background: #333;
  overflow: hidden;
}

.battle-tooltip__bar-fill {
  height: 100%;
  background: #ffd54f;
}

.hex-flash {
  animation: owner-flash 0.6s ease-out;
}

@keyframes owner-flash {
  0% {
    fill: #ffffff;
    fill-opacity: 0.9;
  }
  60% {
    fill: #ffffff;
    fill-opacity: 0.8;
  }
  100% {
    fill-opacity: 0.5;
  }
}
</style>
