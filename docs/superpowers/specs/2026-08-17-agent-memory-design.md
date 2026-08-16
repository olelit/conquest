# Дизайн: память ассистента (agent-driven графовая память)

Дата: 2026-08-17

## Обзор

Постоянная графовая память для ассистента (opencode): что ассистент узнал о проектах, решениях, предпочтениях пользователя. Интеллект — сам ассистент (использует модель opencode, «существующую подписку»), хранилище — популярный сторонний граф Neo4j (Community), визуализация — Neo4j Browser по URL. Внешних LLM-ключей нет.

## Решения по требованиям

- **Третья сторона с GitHub, популярность:** Neo4j (граф-хранилище + стандартный веб-браузер графа).
- **«Хук» и подписка opencode:** никакой внешний LLM-эндпоинт не используется. Извлечение фактов и семантический поиск делает сам ассистент (его модель уже оплачена подпиской opencode).
- **Вектор:** серверная векторная часть не нужна — семантическое сопоставление на стороне агента при поиске. Локальная эмбеддинг-модель — возможное будущее расширение, не входит в объём.
- **Расположение:** папка проекта (в этом репозитории conquest).
- **Сид:** граф наполняется из существующих дизайн-доков/планов/глоссария проекта.

## Архитектура

```
opencode (ассистент, модель из подписки)
   │  MCP-инструменты memory_add / memory_search / memory_related
   ▼
memory/ (в репо conquest)
   ├─ mcp-server/   — маленький MCP-сервер (Node/TS), ходит в Neo4j по Bolt
   ├─ seed/         — скрипты засыдки фактов из docs/
   └─ docker-compose.yml — Neo4j Community (bolt 7687, http 7474)
```

- Neo4j Browser: `http://localhost:7474` — интерактивный граф, изучение «что знает ассистент».
- opencode config (`opencode.json` в корне репо): секция `mcp` с `memory` сервером — у ассистента появляются инструменты памяти.

## Схема графа

Узлы:

- `:Entity {name, type}` — сущности: проект, компонент, концепция, персона (пользователь/агент), террейн и т.п. Мердж по `name`.
- `:Memory {text, kind, project, createdAt}` — «что ассистент знает»: факт/решение/предпочтение/заметка.

Рёбра:

- `(:Memory)-[:ABOUT]->(:Entity)` — факт о сущности.
- `(:Entity)-[:REL {type: 'depends_on'|'prefers'|'works_with'|...}]->(:Entity)` — связи между сущностями.
- `(:Entity)-[:RECALLS]->(:Memory)` — обратная связь для навигации.

Индексы/ограничения:

- UNIQUE по `Entity.name`.
- Полнотекстовый индекс `FULLTEXT` по `Memory.text` для `memory_search`.

## MCP-инструменты

MCP-сервер (протокол stdio; зависимости: `neo4j-driver` и `@modelcontextprotocol/sdk`):

- `memory_add { text, entities: string[], kind?, project?, relations?: {from, to, type}[] }` — создать/мердж сущности, факт-узел, рёбра. Вернуть id факта.
- `memory_search { query, project?, limit? }` — полнотекст по `Memory.text` + окрестности сущностей из `query`; вернуть топ фактов и связанных сущностей.
- `memory_related { entity, depth? }` — сущность + её соседи и связанные факты (для изучения).

## Визуализация

Neo4j Browser по `http://localhost:7474` (логин из docker-compose): пользователь видит весь граф, кликает сущности/факты, смотрит связи. Это основная «отдельная урла» для изучения.

## Поток данных

1. В сессии ассистент (и/или пользователь) вызывает `memory_add` для долгоживущих фактов.
2. При старте/по делу — `memory_search` возвращает контекст.
3. Сид: `seed/` прогоняет `docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md`, `docs/glossary.md` → `memory_add` пакетно (факты про архитектуру, правила игры, решения, термины, предпочтения).

## Защита/безопасность

- Данные локальные, в репозитории (`memory/neo4j-data/` в `.gitignore`), наружу ничего не отправляется.
- Neo4j-креды в `docker-compose.yml` локальные, не публиковать.

## Проверка

1. `docker compose -f memory/docker-compose.yml up -d` → Neo4j отвечает (`/health` на 7474, bolt 7687).
2. MCP подключён: после перезапуска opencode у ассистента видны инструменты `memory_add/search/related`.
3. Сид прогнан: `memory_search('fortress')` возвращает факты про крепость; в Browser виден граф.
4. `cd web && npm run build`, `cd server && npm test` — проект conquest не сломан (изменения затрагивают только `memory/` и `opencode.json`).

## Файлы

- `memory/docker-compose.yml`
- `memory/mcp-server/package.json`, `memory/mcp-server/src/index.ts`
- `memory/seed/seed.ts` (+ данные/скрипт прогона)
- `opencode.json` — секция `mcp`
- `.gitignore` — `memory/neo4j-data/`
- Эта спецификация: `docs/superpowers/specs/2026-08-17-agent-memory-design.md`
