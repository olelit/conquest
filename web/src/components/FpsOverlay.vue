<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const fps = ref(0);
const minFps = ref(Infinity);
const sumFps = ref(0);
const samples = ref(0);
const startedAt = ref(Date.now());
const showSummary = ref(false);
let raf = 0;
let frames = 0;
let last = 0;
let lastUpdate = 0;

function loop(now: number): void {
  frames++;
  if (last) {
    const dt = now - last;
    if (dt > 0) {
      const current = 1000 / dt;
      if (now - lastUpdate > 500) {
        fps.value = Math.round(current);
        minFps.value = Math.min(minFps.value, current);
        sumFps.value += current;
        samples.value++;
        lastUpdate = now;
      }
    }
  }
  last = now;
  raf = requestAnimationFrame(loop);
}

function avgFps(): number {
  return samples.value ? Math.round(sumFps.value / samples.value) : 0;
}

function duration(): number {
  return Math.round((Date.now() - startedAt.value) / 1000);
}

onMounted(() => {
  raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="fps-overlay">
    <div class="fps-overlay__live">FPS: {{ fps }}</div>
    <button class="fps-overlay__btn" @click="showSummary = !showSummary">
      {{ showSummary ? 'Скрыть итог' : 'Итог' }}
    </button>
    <div v-if="showSummary" class="fps-overlay__summary">
      <div>Мин: {{ Math.round(minFps) }}</div>
      <div>Средний: {{ avgFps() }}</div>
      <div>Время: {{ duration() }} с</div>
    </div>
  </div>
</template>

<style scoped>
.fps-overlay {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(20, 20, 26, 0.9);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 10px 14px;
  color: #fff;
  font-size: 14px;
}

.fps-overlay__live {
  font-weight: 700;
  font-size: 20px;
}

.fps-overlay__btn {
  padding: 4px 10px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a31;
  color: #fff;
  cursor: pointer;
}

.fps-overlay__btn:hover {
  background: #3a3a44;
}

.fps-overlay__summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #ccc;
}
</style>
