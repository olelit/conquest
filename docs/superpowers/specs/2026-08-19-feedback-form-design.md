# Дизайн: форма фидбека с просмотром в админке и лимитом по IP

Дата: 2026-08-19

## Проблема

Игроки не могут оставить отзыв о игре. Нужна простая форма фидбека,
просмотр отзывов в админ-панели и защита от спама — лимит отправок по IP
(раз в минуту).

## Решение

Форма на главном меню (Vue-клиент) → публичный `POST /api/feedback`
→ таблица `feedback` в PostgreSQL. Админ просматривает отзывы в новой
вкладке «Отзывы» (список, пометка «прочитано», удаление).
Rate limit — in-memory скользящее окно 60с на IP.

## Сервер

### Хранение

Новая сущность `FeedbackEntity` (таблица `feedback`), регистрируется в
`dataSource` (`synchronize: true` создаёт таблицу):

| колонка | тип | описание |
|---|---|---|
| `id` | int, PK | автоинкремент |
| `text` | text | текст отзыва |
| `ip` | text | IP отправителя |
| `read` | boolean, default false | прочитан ли админом |
| `created_at` | timestamptz, default now() | время отправки |

`FeedbackRepository` (паттерн `DumpsRepository`):
- `async create(text: string, ip: string): Promise<number>` — вставка, возврат id;
- `async list(): Promise<FeedbackEntity[]>` — все, новые сверху (`ORDER BY id DESC`);
- `async markRead(id: number): Promise<boolean>` — `UPDATE read = true`, false если id нет;
- `async remove(id: number): Promise<boolean>` — удаление, false если id нет.

### Rate limiter

Отдельный модуль `server/src/rate-limit.ts`, чистый и unit-тестируемый:

```ts
export class SlidingWindowLimiter {
  constructor(private readonly windowMs: number) {}
  private hits = new Map<string, number[]>();
  try(ip: string, limit: number): boolean;
  sweep(now: number): void; // чистка записей старше windowMs
  size(): number; // для тестов
}
```

- `try` — добавляет текущий timestamp в массив IP, отбрасывает записи старше
  `windowMs`, возвращает `true`, если записей ≤ limit, иначе `false`.
- `sweep` удаляет пустые записи IP — защита от роста памяти; вызывается
  периодически из `setInterval(sweep, 60000)` в `server/src/index.ts`.

### Конфиг

`server/src/config.ts`:
```ts
feedbackRateLimit: number('CONQUEST_FEEDBACK_RATE_LIMIT', 3),
```

### Определение IP

Хелпер (за прокси nginx/vite):
`x-forwarded-for` (первое значение) → `x-real-ip` → `socket.remoteAddress`.

### Эндпоинты

`POST /api/feedback` (публичный):
- body: `{ text }`; `text` не строка → 400;
- `text.trim()` пустой → 400 `{ ok: false, error: 'empty' }`;
- `text.trim().length > 2000` → 400 `{ ok: false, error: 'too-long' }`;
- лимит превышен → 429 `{ ok: false, error: 'rate-limit' }`;
- успех → `{ ok: true }`.

Защищённые (`requireAdmin`, добавляются в `protectedRouter` в `admin.ts`):
- `GET /api/admin/feedback` → `{ ok: true, feedback: [...] }`;
- `POST /api/admin/feedback/:id/read` → `{ ok: true }` или 404;
- `DELETE /api/admin/feedback/:id` → `{ ok: true }` или 404.

## Web (Vue)

- На главном меню кнопка «Фидбек» → модалка с textarea (только текст),
  кнопки «Отправить»/«Отмена».
- Отправка `POST /api/feedback` через fetch (`credentials` не нужны).
- Сообщения: успех, ошибка сети, «слишком много попыток — подождите» (429),
  пустой/длинный текст.
- i18n: ключи `feedback.title`, `feedback.placeholder`, `feedback.send`,
  `feedback.cancel`, `feedback.sent`, `feedback.error`, `feedback.rateLimited`,
  `feedback.tooLong` (en/ru).

## Админка (admin.html)

- Новая вкладка «Отзывы» (рядом с «Обзор»/«Аккаунт»).
- Таблица: дата, IP, текст; кнопки «Прочитано»/«Удалить»; маркер прочитано
  (визуально, например цвет строки). Обновление списка после действий.
- Просмотр только для авторизованного админа (вкладка доступна в дашборде).

## Тестирование

- `rate-limit.test.ts`: в окне — до лимита true, за лимитом false;
  после окончания окна снова true; `sweep` удаляет старые записи;
  разные IP не мешают друг другу.
- `feedback-http.test.ts` (паттерн `admin-http.test.ts`, тестовый express +
  стаб-репозиторий): пустой текст → 400; слишком длинный → 400;
  лимит → 429; успех → 200 `{ ok: true }`; админ-роуты: список, прочитано, удаление, 404.

## Открытые вопросы

Нет.
