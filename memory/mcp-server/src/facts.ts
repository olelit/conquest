import type { MemoryInput } from './graph.js';

function fact(input: Omit<MemoryInput, 'kind'> & { kind?: MemoryInput['kind'] }): MemoryInput {
  return { project: 'conquest', kind: 'fact', ...input };
}

export const SEED_FACTS: MemoryInput[] = [
  fact({
    text: 'Conquest — real-time стратегия: захват гексов на гексагональной карте в реальном времени (без ходов).',
    entities: ['Conquest'],
  }),
  fact({
    text: 'Клиент на Vue 3 (<script setup>), TypeScript, Vite; сборка: vue-tsc -b && vite build.',
    entities: ['Conquest', 'Vue 3', 'TypeScript', 'Vite'],
    relations: [
      { type: 'depends_on', from: 'Conquest', to: 'Vue 3' },
      { type: 'depends_on', from: 'Conquest', to: 'TypeScript' },
      { type: 'depends_on', from: 'Conquest', to: 'Vite' },
    ],
  }),
  fact({
    text: 'Сервер на Node.js + ws (WebSocket), TypeScript; тесты — vitest; компиляция — tsc.',
    entities: ['Conquest', 'Server', 'Node.js', 'ws', 'vitest'],
    relations: [
      { type: 'depends_on', from: 'Server', to: 'Node.js' },
      { type: 'depends_on', from: 'Server', to: 'ws' },
      { type: 'uses', from: 'Server', to: 'vitest' },
    ],
  }),
  fact({
    text: 'Деплой через Docker (docker-compose, docker-compose.prod.yml).',
    entities: ['Conquest', 'Docker'],
    relations: [{ type: 'deploys_with', from: 'Conquest', to: 'Docker' }],
  }),
  fact({
    text: 'Правило: захват нейтрального гекса стоит очки по стоимости террейна (grass 150, desert 200, forest 250, water 350, mountain/mine 450).',
    entities: ['Conquest', 'terrain'],
  }),
  fact({
    text: 'Правило: атака вражеского гекса возможна только после объявления войны.',
    entities: ['Conquest', 'war'],
  }),
  fact({
    text: 'Правило: битва решается вложениями очков — перевес атаки/защиты забирает гекс.',
    entities: ['Conquest', 'battle'],
  }),
  fact({
    text: 'Правило: крепость защищает свой гекс и 6 соседних гексов своего владельца (радиус 1).',
    entities: ['Conquest', 'fortress'],
  }),
  fact({
    text: 'Правило: потеря столицы = выбывание; отрезанная от столицы территория становится нейтральной.',
    entities: ['Conquest', 'capital'],
  }),
  fact({
    text: 'Дипломатия: война/мир/союз; действуют предложения peace/alliance между игроками.',
    entities: ['Conquest', 'diplomacy', 'peace', 'alliance'],
  }),
  fact({
    text: 'Режим «Обучение»: соло против лёгкого ИИ; машина из 6 этапов на клиенте (capture, attack, defend, fortress, diplomacy, done) с паузой на каждом этапе.',
    entities: ['Conquest', 'training'],
  }),
  fact({
    text: 'Нагрузочный тест: комната с N ИИ (5/10/20/30) на круглой карте round.',
    entities: ['Conquest', 'load test'],
  }),
  fact({
    text: 'UI имеет языки EN/RU, по умолчанию английский; сервер всегда на английском.',
    entities: ['Conquest', 'i18n'],
  }),
  fact({
    text: 'ИИ расширяет территорию компактно: избегает тонких коридоров шириной в одну клетку — их легко отрезать соседям.',
    entities: ['Conquest', 'AI'],
  }),
  fact({ text: 'Пользователь общается с ассистентом по-русски.', entities: ['user'], kind: 'preference' }),
  fact({ text: 'Пользователь предпочитает серверные строки на английском языке.', entities: ['user'], kind: 'preference' }),
];
