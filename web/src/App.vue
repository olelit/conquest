<script setup lang="ts">
import { onMounted, ref } from 'vue';
import HexMap from './components/HexMap.vue';
import type { Hex } from './types';

const hexes = ref<Hex[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const res = await fetch('/api/map');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    hexes.value = data.hexes;
  } catch (err) {
    error.value = `Не удалось загрузить карту: ${
      err instanceof Error ? err.message : String(err)
    }`;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <main class="app">
    <h1>Conquest</h1>
    <p v-if="loading" class="status">Загрузка карты…</p>
    <p v-else-if="error" class="status error">{{ error }}</p>
    <HexMap v-else :hexes="hexes" />
  </main>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.status {
  color: #aaa;
}

.error {
  color: #ff6b6b;
}
</style>
