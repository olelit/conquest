# Дизайн: хоткеи и удобство

Дата: 2026-08-14

## Обзор

Горячие клавиши в игре: цифры для армии, Tab — полная карта, Пробел — пауза (соло), Esc — закрытие меню/бургера. Строка-подсказка с хоткеями.

## 1. Хоткеи (web/src/App.vue)

Единый обработчик `onHotkey(e: KeyboardEvent)` на `window` (keydown; снятие в onBeforeUnmount):
- guard: `(e.target as HTMLElement | null)?.closest('input, select, textarea')` — не срабатывает при вводе;
- `Digit1..Digit9` → `army.value = digit * 10` (10%..90%);
- `Digit0` → `army.value = 100`;
- `Tab` → `e.preventDefault()`, сброс камеры (см. §2);
- `Space` → `e.preventDefault()`; если `showPause` (соло) — `onPause()`;
- `Escape` → закрыть контекстное меню (существующее поведение `onMenuKeydown`) и бургер-меню (`burgerOpen = false`).

Существующий `onMenuKeydown` (Esc для ПКМ-меню) объединяется с `onHotkey`.

## 2. Сброс камеры (web/src/components/HexMap.vue)

- `function resetView(): void { view.value = null; }`
- `defineExpose({ resetView })`.
- App.vue: `const hexMapRef = ref<InstanceType<typeof HexMap> | null>(null)`; шаблон `ref="hexMapRef"`; Tab → `hexMapRef.value?.resetView()`.

## 3. Подсказки

- Строка внизу слева (фиксированная, приглушённая): «1–9/0 — армия · Tab — карта · Пробел — пауза».
- Показывается в игре (`room && game`), кроме режима нагрузочного теста (`!room.loadTest`).

## 4. Тесты

- Web: `npm run build` (vue-tsc + vite). Тестового раннера в web нет.
- Сервер не меняется.

## 5. Файлы

- Изменить: `web/src/App.vue`, `web/src/components/HexMap.vue`.
