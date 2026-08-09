# Conquest: Docker-сборка (Postgres + Node TS + Vue TS)

Дата: 2026-08-09

## Цель

Полноценная docker-сборка для игры Conquest: PostgreSQL, Node.js (TypeScript) и Vue 3 (TypeScript). Vue общается с Node через единый URL (прокси, без CORS). В браузере видно игровое поле из гексов (pointy-top, как в Civilization); при наведении на гекс появляется обводка.

## Архитектура

Три сервиса в общей сети `conquest_network`:

| Сервис | Стек | Порт |
|---|---|---|
| `postgres` | postgres:16, volume для данных, healthcheck | 5432 (только внутри сети) |
| `api` | Node 22 + TypeScript, Express + `pg` | 3000 (только внутри сети) |
| `web` | Vue 3 + Vite + TypeScript, SVG-рендер гексов | 5173 (dev) / 8080 (prod) |

### Единый URL

- **Dev-профиль** (`docker-compose.yml`, по умолчанию): Vite dev server на `http://localhost:5173`, прокси `/api → api:3000`. Hot-reload для Vue (Vite) и для Node (`tsx watch`).
- **Prod-профиль** (`docker-compose.prod.yml`): nginx раздаёт собранный статический Vue и проксирует `/api → api:3000`. Один URL: `http://localhost:8080`.

### Данные о поле

1. Node при старте подключается к Postgres (ретраи, пока БД не готова), создаёт таблицу `hexes(q int, r int, terrain text)` с primary key `(q, r)`.
2. Если таблица пуста — сидирует поле 16×12 гексов со случайными типами местности: равнина, лес, горы, вода, пустыня.
3. `GET /api/map` → `{ hexes: [{ q, r, terrain }] }`. JSON минимальный, без лишней вложенности.

### Рендер гексов (Vue)

- Pointy-top гексы, axial-координаты `(q, r)`, размер hex ~30px.
- Сетка рисуется SVG `<polygon>` на `<svg>`, размер viewBox вычисляется из границ карты (16×12).
- Цвет полигона — по типу местности.
- Hover: CSS `:hover` на полигоне → утолщённая обводка + лёгкая подсветка.
- В углу экрана показываются координаты выбранного гекса (полезно для отладки).
- Если запрос к API упал — показываем сообщение об ошибке вместо пустого экрана.

## Структура репозитория

```
conquest/
├── docker-compose.yml          # dev-профиль
├── docker-compose.prod.yml     # prod-профиль
├── .gitignore
├── .dockerignore
├── docker/
│   ├── app/Dockerfile          # API: dev (multi-stage для prod-сборки)
│   └── web/
│       ├── Dockerfile          # nginx + собранный Vue (prod)
│       └── nginx.conf          # раздача статики + прокси /api
├── server/                     # Node TS
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Express: GET /api/map, /health
│       ├── db.ts               # подключение к Postgres, инициализация схемы
│       └── map.ts              # генерация/сид поля, типы местности
└── web/                        # Vue 3 + TS (Vite)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts          # прокси /api → http://api:3000
    ├── index.html
    └── src/
        ├── main.ts
        ├── App.vue             # загрузка карты + рендер поля
        ├── types.ts            # интерфейсы Hex, Terrain
        └── components/
            ├── HexMap.vue      # SVG-сетка, hover-подсветка
            └── HexCoordinates.vue  # координаты выбранного гекса
```

## Переменные окружения

`api` читает из окружения: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`. В docker-compose задаются значения по умолчанию (`conquest`/`conquest`/`conquest_db`).

## Обработка ошибок

- Node ретраит подключение к Postgres (healthcheck + retry в коде), при провале — падает с понятным сообщением в логах.
- Vue при ошибке запроса показывает сообщение и не рендерит поле.
- Сид выполняется только при пустой таблице — рестарт не дублирует данные.

## Критерии приёмки

1. `docker compose up` → `http://localhost:5173` показывает поле 16×12 гексов.
2. Наведение на гекс даёт обводку.
3. Данные приходят из API (проверка: `curl localhost:5173/api/map` возвращает JSON с гексами; без БД поле не появится).
4. `docker compose -f docker-compose.prod.yml up` → `http://localhost:8080` работает так же.
5. Рестарт контейнеров не дублирует поле в Postgres.

## Вне скоупа (позже)

- Террейн-атрибуты (защита, ресурсы, движение).
- Юниты и игровая логика.
- WebSocket-синхронизация.
- Мультиплеер.
