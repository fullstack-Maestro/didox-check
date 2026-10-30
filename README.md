# Проверка контрагента (Didox API)

Статический одностраничный сайт для GitHub Pages. Пользователь вводит **ИНН** (9 цифр, юрлицо) или **ПИНФЛ** (14 цифр, физлицо), сайт обращается к Didox API и показывает:

| Карточка | Поле JSON |
|---|---|
| ЯТТ (индивидуальный предприниматель) | `isItd` |
| Самозанятость | `selfEmployment` |
| Плательщик налога по упрощёнке (6% с оборота) | `VATRegSimplified` |

Плюс название, ИНН, ОПФ, статус налогоплательщика, адрес, ОКЭД, руководитель, рег. код и статус НДС и т.д. Есть кнопка «Показать JSON», история последних 5 проверок и переключатель RU/UZ.

> ⚠️ В документации Didox поля `isItd` и `VATRegSimplified` помечены как **служебные**: «не используйте их в интеграции, они могут измениться без уведомления». Если карточки вдруг начнут показывать «Нет данных» — проверьте сырой JSON и поправьте `CONFIG.statusFields` в `app.js`.

## Какой метод API используется

Документация: <https://api-docs.didox.uz/ru/integrators-utils> (раздел «16. Получить данные организации по ИНН или ПИНФЛ»).

```
GET https://api-partners.didox.uz/v1/utils/info/{taxIdOrPinfl}
user-key: <USER_TOKEN>
Partner-Authorization: <PARTNER_TOKEN>   # необязательно
Accept-Language: ru | uz
```

- **Partner-Authorization** — партнёрский токен (выдаёт аккаунт-менеджер Didox, <https://t.me/Didox_account>). В документации он указан как обязательный, но на практике (проверено в октябре 2026) метод `/v1/utils/info` отвечает и с одним `user-key`. Поэтому на сайте это поле необязательное: если заполнено — заголовок отправляется, если пусто — нет.
- **user-key** — токен пользователя, действует **360 минут**. Получается методом `POST /v1/auth/{ИНН|ПИНФЛ}/password/{ru|uz}` с телом `{"password": "..."}` (или по ЭЦП). На сайте есть форма «Получить user-key по ИНН/ПИНФЛ и паролю» — она делает именно этот запрос.
- Тестовый сервер: `https://testapi3.didox.uz`.

CORS: на момент написания Didox отвечает `Access-Control-Allow-Origin: *` для этих методов, поэтому запросы прямо из браузера с `*.github.io` работают. Если это изменится — см. раздел «Если CORS блокирует запросы».

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Разметка |
| `style.css` | Стили, светлая/тёмная тема через `prefers-color-scheme` |
| `app.js` | Вся логика. Объект `CONFIG` в начале файла — адреса API, пути, названия заголовков и полей, API-ключи E-IMZO |
| `eimzo.js` | Маленький клиент E-IMZO (WebSocket к приложению на `127.0.0.1`) |
| `README.md` | Эта инструкция |

## Публикация на GitHub Pages — пошагово

1. Зайдите на <https://github.com> → **New repository**. Имя, например, `didox-check`. Видимость — **Public** (Pages для приватных репозиториев требует платного тарифа). Нажмите **Create repository**.
2. На странице репозитория: **Add file → Upload files**. Перетащите `index.html`, `style.css`, `app.js`, `eimzo.js`, `README.md`. Нажмите **Commit changes**.
   - Или через git:
     ```bash
     git init && git add . && git commit -m "Counterparty checker"
     git branch -M main
     git remote add origin https://github.com/<ваш-логин>/didox-check.git
     git push -u origin main
     ```
3. **Settings → Pages** → *Build and deployment* → *Source*: **Deploy from a branch** → Branch: **main**, папка **/ (root)** → **Save**.
4. Через 1–2 минуты сайт будет доступен по адресу `https://<ваш-логин>.github.io/didox-check/` (ссылка появится там же, в Settings → Pages).

## Настройка API-адреса и токенов

**Никаких секретов в коде нет и класть их туда нельзя**: GitHub Pages публичный, любой может открыть `app.js` и увидеть всё, что в нём написано.

Вместо этого каждый пользователь вводит токены сам:

1. Откройте сайт → **⚙ Настройки** (при первом визите открываются автоматически).
2. Выберите API-адрес: боевой `api-partners.didox.uz`, тестовый `testapi3.didox.uz` или свой (прокси).
3. **Partner-Authorization** — по желанию (можно оставить пустым).
4. Вставьте **user-key** вручную — или получите его автоматически (см. следующий раздел).
5. **Сохранить**. Токены хранятся только в `localStorage` этого браузера и отправляются только на выбранный API-адрес. Кнопка «Удалить всё сохранённое» стирает токены и сохранённый пароль.

## Автоматическое получение user-key

В настройках, блок «Получить user-key автоматически», две вкладки.

### Логин и пароль

`POST /v1/auth/{ИНН|ПИНФЛ}/password/{ru|uz}` с телом `{"password": "..."}`.

- Введите ИНН/ПИНФЛ и пароль Didox → «Получить токен».
- Галочка **«Запомнить пароль… и входить автоматически»** включает автовход: если токена нет, он истекает (менее 5 минут до конца 6-часового срока) или Didox ответил `401 Invalid user key`, сайт сам войдёт заново и повторит запрос. Пользователь ничего не замечает.
- Пароль при этом хранится в `localStorage` **в открытом виде** — включайте только на личном компьютере.
- Защита от блокировки: Didox блокирует вход после неверных попыток (3 в минуту → 10 мин, 10 → сутки, 25 → **навсегда**). Поэтому если автовход получил отказ (неверный пароль, блокировка, слишком много попыток), сохранённый пароль **сразу удаляется** и автовход выключается — повторных попыток не будет.

### E-IMZO (ЭЦП)

Схема из документации Didox (<https://api-docs.didox.uz/ru/integrators-eimzo>):

1. Сайт подключается к приложению E-IMZO на компьютере (`wss://127.0.0.1:64443` для https-страниц, `ws://127.0.0.1:64646` для http) и получает список ключей `.pfx`.
2. Выбранным ключом подписывается ИНН компании (из сертификата; для ключа физлица — ПИНФЛ) в base64. **Пароль ключа вводится в окне E-IMZO**, сайт его не видит и не хранит.
3. Подпись отправляется в `POST /v1/dsvs/timestamp`, полученный `timeStampTokenB64` — в `POST /v1/auth/{ИНН}/token/{ru|uz}` → `user-key`.

Галочка «Входить этим ключом автоматически» запоминает выбранный ключ (только его серийный номер). Когда токен истекает, при следующей проверке сразу откроется окно E-IMZO для ввода пароля ключа. Полностью без участия человека вход по ЭЦП невозможен — так устроен E-IMZO.

Требования:

- Установлено и запущено приложение E-IMZO (<https://e-imzo.uz>), версия 3.36 или новее; флешка с ключом вставлена.
- **API-ключ домена обычно не нужен.** Как и в документации Didox, сайт сразу запрашивает у E-IMZO список ключей и подпись. Команда `apikey` отправляется «на всякий случай» (встроены публичные ключи для `localhost` и `127.0.0.1` из официального `e-imzo-client.js`), её отказ не останавливает вход. Если E-IMZO всё же откажет этому домену, ключ можно получить у разработчиков E-IMZO (<https://e-imzo.uz>) и вставить в настройках («API-ключ E-IMZO для этого сайта») или добавить в `CONFIG.eimzoApiKeys`:
  ```js
  eimzoApiKeys: [
    'localhost', '96D0…',
    '127.0.0.1', 'A7BC…',
    'fullstack-maestro.github.io', '<ключ от E-IMZO>',
  ],
  ```
  API-ключ домена не секретный (он виден в коде любого сайта с E-IMZO), его можно хранить в репозитории.
- **Если E-IMZO отказывает домену github.io** — откройте сайт локально:
  ```bash
  git clone https://github.com/fullstack-Maestro/didox-check.git
  cd didox-check
  python3 -m http.server 8000
  # → http://localhost:8000
  ```
- Chrome/Edge могут спросить разрешение на доступ сайта к «устройствам в локальной сети» — разрешите, иначе браузер не пустит страницу к E-IMZO.
- Поддерживаются ключи `.pfx` (файлы на диске/флешке). USB-токены и ID-карты пока не поддерживаются.

Чтобы поменять адреса по умолчанию, пути или поля — отредактируйте `CONFIG` в начале `app.js`:

```js
const CONFIG = {
  apiPresets: { prod: 'https://api-partners.didox.uz', test: 'https://testapi3.didox.uz' },
  defaultPreset: 'prod',
  infoPath: '/v1/utils/info/{id}',
  statusFields: [ { key: 'isItd', ... }, { key: 'selfEmployment', ... }, { key: 'VATRegSimplified', ... } ],
  ...
};
```

### Проверка локально

Достаточно открыть `index.html` в браузере, но надёжнее через локальный сервер (для E-IMZO с `localhost` встроен API-ключ):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Обработка ошибок

| Ситуация | Что видит пользователь |
|---|---|
| Неверный ввод | «Допустимы только цифры» / «Неверная длина…» — запрос не отправляется |
| Нет user-key | «Не указан user-key», открываются настройки |
| 401 `No user key or partner token passed` | «Не переданы токены» |
| 401 `Invalid user key` | «Токен пользователя недействителен» (истёк — получите новый) |
| 403 / прочие 401 | Ошибка авторизации / доступ запрещён (партнёрский токен) |
| 404, пустой ответ | «Контрагент не найден» |
| 400 / 422 | «Запрос отклонён» + текст сервера |
| 429 | «Слишком много запросов» |
| 5xx | «Ошибка на стороне API» (Didox так отвечает и когда НК не вернул данные) |
| Таймаут 20 с | «Превышено время ожидания» |
| Браузер офлайн | «Нет подключения к интернету» |
| CORS | «Браузер заблокировал запрос (CORS)» — определяется пробным `no-cors` запросом: если сервер доступен, а обычный запрос упал, значит дело в CORS |
| Прочие сетевые ошибки | «Сетевая ошибка» |

## Если CORS блокирует запросы

Браузер не даст странице с `https://<логин>.github.io` прочитать ответ чужого сервера, если тот не прислал заголовок `Access-Control-Allow-Origin`. Варианты:

### (а) Попросить Didox разрешить ваш адрес

Напишите аккаунт-менеджеру Didox и попросите добавить origin `https://<ваш-логин>.github.io` в CORS-разрешения для методов `/v1/utils/info/*` и `/v1/auth/*` (методы `GET`, `POST`; заголовки `Partner-Authorization`, `user-key`, `Content-Type`, `Accept-Language`).

### (б) Свой бесплатный прокси на Cloudflare Workers

Прокси решает сразу две задачи: снимает проблему CORS и **хранит токены на сервере**, так что пользователям сайта не нужно ничего вводить. Бесплатного тарифа Workers (100 000 запросов в сутки) хватает с запасом.

1. Зарегистрируйтесь на <https://dash.cloudflare.com> → **Workers & Pages → Create → Create Worker** → назовите `didox-proxy` → **Deploy** → **Edit code**, вставьте код ниже → **Deploy**.
2. **Settings → Variables and Secrets** — добавьте (тип *Secret* для токенов и пароля):
   - `PARTNER_TOKEN` — партнёрский токен Didox (необязательно)
   - `DIDOX_LOGIN` — ИНН/ПИНФЛ учётной записи Didox
   - `DIDOX_PASSWORD` — пароль Didox
   - `ALLOWED_ORIGIN` — `https://<ваш-логин>.github.io` (тип *Text*)
   - `DIDOX_BASE` — необязательно, по умолчанию `https://api-partners.didox.uz`
3. На сайте: **Настройки → API-адрес → «Свой адрес (прокси)»** → `https://didox-proxy.<ваш-аккаунт>.workers.dev`. Поля токенов оставьте **пустыми** → Сохранить.
   Чтобы это было по умолчанию для всех, поменяйте в `app.js`: `apiPresets.prod` на адрес воркера.

```js
// Cloudflare Worker: CORS-прокси к Didox для одного метода GET /v1/utils/info/{ИНН|ПИНФЛ}.
// Токены живут только здесь (в Secrets), браузер их не видит.

let cachedKey = null;      // user-key Didox
let cachedUntil = 0;       // когда считать его просроченным (ms)
let loginBlockedUntil = 0; // пауза после неудачного входа — защита от блокировки учётки

const KEY_TTL_MS = 5.5 * 60 * 60 * 1000;   // Didox выдаёт токен на 6 ч, обновляем чуть раньше
const LOGIN_RETRY_MS = 10 * 60 * 1000;     // после ошибки входа не пробуем 10 минут

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Accept-Language, Partner-Authorization, user-key',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Origin — не защита от curl, но отсекает чужие сайты в браузере.
    if (origin && origin !== allowed) return text('Forbidden origin', 403, cors);
    if (request.method !== 'GET') return text('Method not allowed', 405, cors);

    // Пропускаем ТОЛЬКО метод получения данных организации.
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v1\/utils\/info\/(\d{9}|\d{14})$/);
    if (!m) return text('Not found', 404, cors);

    const base = (env.DIDOX_BASE || 'https://api-partners.didox.uz').replace(/\/+$/, '');
    const lang = request.headers.get('Accept-Language') === 'uz' ? 'uz' : 'ru';

    const callDidox = async (userKey) => fetch(`${base}/v1/utils/info/${m[1]}`, {
      headers: {
        ...partnerHeader(env),
        'user-key': userKey,
        'Accept': 'application/json',
        'Accept-Language': lang,
      },
    });

    let userKey;
    try { userKey = await getUserKey(env, base); }
    catch (e) { return text('Proxy login failed: ' + e.message, 502, cors); }

    let res = await callDidox(userKey);
    if (res.status === 401) {            // токен истёк раньше времени — один повтор
      cachedKey = null;
      try { userKey = await getUserKey(env, base); }
      catch (e) { return text('Proxy login failed: ' + e.message, 502, cors); }
      res = await callDidox(userKey);
    }

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};

async function getUserKey(env, base) {
  const now = Date.now();
  if (cachedKey && now < cachedUntil) return cachedKey;
  if (now < loginBlockedUntil) throw new Error('login paused after previous failure');

  const res = await fetch(`${base}/v1/auth/${env.DIDOX_LOGIN}/password/ru`, {
    method: 'POST',
    headers: { ...partnerHeader(env), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ password: env.DIDOX_PASSWORD }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.token) {
    loginBlockedUntil = now + LOGIN_RETRY_MS;   // не долбим вход неверным паролем
    throw new Error(`HTTP ${res.status}`);
  }
  cachedKey = data.token;
  cachedUntil = now + KEY_TTL_MS;
  return cachedKey;
}

// Partner-Authorization отправляем, только если секрет задан.
function partnerHeader(env) {
  return env.PARTNER_TOKEN ? { 'Partner-Authorization': env.PARTNER_TOKEN } : {};
}

function text(msg, status, headers) {
  return new Response(msg, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}
```

Замечания по прокси:

- Адрес воркера публичный: любой, кто его узнает, сможет делать проверки от имени вашей учётной записи (проверка `Origin` легко подделывается вне браузера). Для внутреннего использования добавьте в Cloudflare правило **Rate limiting** (Security → WAF) или защитите воркер через **Cloudflare Access**.
- Кэш `user-key` хранится в памяти экземпляра воркера; при холодном старте воркер просто войдёт заново. При неудачном входе воркер делает паузу 10 минут, чтобы не попасть под блокировку Didox за перебор пароля.

## Безопасность — кратко

- В репозитории нет ни одного токена. Не коммитьте их и не вписывайте в `CONFIG`.
- Токены в `localStorage` доступны любому, кто сидит за этим компьютером/браузером. Не сохраняйте их на общих машинах; кнопка «Удалить всё сохранённое» стирает их.
- Галочка «Запомнить пароль» хранит пароль Didox в `localStorage` в открытом виде. Для общих компьютеров используйте E-IMZO — там пароль ключа не попадает на сайт.
- Вывод данных из API делается только через `textContent` — HTML из ответа не исполняется.
