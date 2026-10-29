/* ============================================================
   Counterparty checker (Didox API) — static, no build step.

   Flow: user enters ИНН (9 digits) or ПИНФЛ (14 digits) →
   GET {baseUrl}/v1/utils/info/{id} with headers
   Partner-Authorization + user-key → render statuses.

   Tokens are NEVER hard-coded. The user pastes them into the
   settings panel; they live only in this browser's localStorage.
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   CONFIG — everything API-specific lives here.
   Field names follow the Didox docs (section "08. Утилиты",
   method 16 "Получить данные организации по ИНН или ПИНФЛ").
   ------------------------------------------------------------ */
const CONFIG = {
  // Base URLs. "custom" is entered by the user (e.g. a Cloudflare Worker proxy).
  apiPresets: {
    prod: 'https://api-partners.didox.uz',
    test: 'https://testapi3.didox.uz',
  },
  defaultPreset: 'prod',

  // Endpoints. {id} = ИНН/ПИНФЛ, {lang} = ru | uz.
  infoPath: '/v1/utils/info/{id}',
  loginPath: '/v1/auth/{id}/password/{lang}',

  // Auth headers required by Didox.
  headers: {
    partner: 'Partner-Authorization',
    user: 'user-key',
  },
  userKeyLifetimeMin: 360,  // user tokens are valid for 360 minutes
  timeoutMs: 20000,
  historySize: 5,

  // The three tax statuses shown as cards (exact JSON field names from the docs).
  statusFields: [
    { key: 'isItd',            label: { ru: 'ЯТТ (индивидуальный предприниматель)', uz: 'YaTT (yakka tartibdagi tadbirkor)' } },
    { key: 'selfEmployment',   label: { ru: 'Самозанятость', uz: "O'zini o'zi band qilgan" } },
    { key: 'VATRegSimplified', label: { ru: 'Плательщик налога по упрощёнке (6% с оборота)', uz: "Soddalashtirilgan soliq to'lovchisi (aylanmadan 6%)" } },
  ],

  // Identity / extra fields shown in the "Сведения" list (only if present in the response).
  detailFields: [
    { key: 'tin',              label: { ru: 'ИНН', uz: 'STIR' } },
    { key: 'shortName',        label: { ru: 'Краткое название', uz: 'Qisqa nomi' } },
    { key: 'na1Name',          label: { ru: 'Организационно-правовая форма', uz: 'Tashkiliy-huquqiy shakli' } },
    { key: 'statusName',       label: { ru: 'Статус налогоплательщика', uz: "Soliq to'lovchi holati" } },
    { key: 'regDate',          label: { ru: 'Дата регистрации', uz: "Ro'yxatdan o'tgan sana" } },
    { key: 'address',          label: { ru: 'Адрес', uz: 'Manzil' } },
    { key: 'oked',             label: { ru: 'ОКЭД', uz: 'IFUT (OKED)' } },
    { key: 'director',         label: { ru: 'Руководитель', uz: 'Rahbar' } },
    { key: 'accountant',       label: { ru: 'Главный бухгалтер', uz: 'Bosh hisobchi' } },
    { key: 'VATRegCode',       label: { ru: 'Рег. код НДС', uz: "QQS ro'yxat kodi" } },
    { key: 'VATRegStatus',     label: { ru: 'Статус сертификата НДС', uz: 'QQS guvohnomasi holati' }, format: 'vatStatus' },
    { key: 'isBudget',         label: { ru: 'Бюджетная организация', uz: 'Byudjet tashkiloti' }, format: 'bool' },
    { key: 'privateNotary',    label: { ru: 'Частный нотариус', uz: 'Xususiy notarius' }, format: 'bool' },
    { key: 'peasantFarm',      label: { ru: 'Дехканское хозяйство', uz: "Dehqon xo'jaligi" }, format: 'bool' },
    { key: 'mfo',              label: { ru: 'МФО банка', uz: 'Bank MFO' } },
    { key: 'account',          label: { ru: 'Расчётный счёт', uz: 'Hisob raqami' } },
  ],

  // VATRegStatus codes from the docs.
  vatStatus: {
    20: { ru: 'активный', uz: 'faol' },
    21: { ru: 'неактивный', uz: 'nofaol' },
    22: { ru: 'приостановлен', uz: "to'xtatilgan" },
  },

  // localStorage keys.
  storageKeys: {
    preset: 'didox.preset',
    customUrl: 'didox.customUrl',
    partnerToken: 'didox.partnerToken',
    userKey: 'didox.userKey',
    userKeyIssuedAt: 'didox.userKeyIssuedAt',
    history: 'didox.history',
    lang: 'didox.lang',
  },
};

/* ------------------------------------------------------------
   UI strings (RU / UZ). {name} placeholders are substituted.
   ------------------------------------------------------------ */
const I18N = {
  ru: {
    title: 'Проверка контрагента',
    settings: 'Настройки',
    settingsTitle: 'Настройки API',
    securityNote: 'Токены хранятся только в localStorage этого браузера и отправляются только на указанный API-адрес. Сайт статический — на сервере ничего не сохраняется. Не используйте эту страницу на чужом компьютере.',
    apiUrl: 'API-адрес',
    customUrl: 'Свой адрес (прокси)',
    customUrlLabel: 'Свой адрес, например Cloudflare Worker',
    partnerHint: '(партнёрский токен от Didox)',
    userKeyHint: '(токен пользователя, действует 6 часов)',
    save: 'Сохранить',
    clear: 'Удалить токены',
    saved: 'Сохранено',
    cleared: 'Токены удалены',
    loginTitle: 'Получить user-key по ИНН/ПИНФЛ и паролю Didox',
    loginWarn: 'Пароль не сохраняется. Внимание: у Didox жёсткая защита от перебора — 3 неверные попытки в минуту блокируют вход на 10 минут, 25 — навсегда.',
    loginTin: 'Ваш ИНН / ПИНФЛ',
    loginPassword: 'Пароль Didox',
    loginBtn: 'Получить токен',
    loginBusy: 'Вход…',
    loginOk: 'Готово: user-key получен и сохранён ({name}).',
    loginNeedPartner: 'Сначала укажите Partner-Authorization.',
    loginNeedFields: 'Введите ИНН/ПИНФЛ (9 или 14 цифр) и пароль.',
    loginBadPassword: 'Неверный ИНН/ПИНФЛ или пароль.',
    loginNotRegistered: 'Пользователь не зарегистрирован в Didox.',
    loginLocked: 'Учётная запись заблокирована. Обратитесь в поддержку Didox.',
    keyValidUntil: 'Токен получен по паролю, действует до {time}.',
    keyExpired: 'Срок действия токена истёк ({time}). Получите новый.',
    inputLabel: 'ИНН (9 цифр) или ПИНФЛ (14 цифр)',
    check: 'Проверить',
    recent: 'Недавние:',
    loading: 'Запрос к API…',
    details: 'Сведения',
    showJson: 'Показать JSON',
    hideJson: 'Скрыть JSON',
    footer: 'Данные: Didox API, метод GET /v1/utils/info/{ИНН|ПИНФЛ}.',
    serviceFieldsNote: 'Поля isItd и VATRegSimplified в документации Didox помечены как служебные и могут измениться без уведомления.',
    yes: 'Да',
    no: 'Нет',
    noData: 'Нет данных',
    typeInn: 'ИНН — юридическое лицо (9 цифр)',
    typePinfl: 'ПИНФЛ — физическое лицо (14 цифр)',
    detectedPrefix: 'Определено: ',
    errEmpty: 'Введите ИНН или ПИНФЛ.',
    errDigits: 'Допустимы только цифры.',
    errLength: 'Неверная длина: {n} цифр. Нужно 9 (ИНН) или 14 (ПИНФЛ).',
    typing: 'Введено цифр: {n}',
    errTitle: 'Ошибка',
    errNoTokens: 'Не указаны токены',
    errNoTokensText: 'Откройте «Настройки» и вставьте Partner-Authorization и user-key (или получите user-key по паролю).',
    errBadUrl: 'Неверный API-адрес',
    errBadUrlText: 'Укажите корректный адрес вида https://… в настройках.',
    errNotFound: 'Контрагент не найден',
    errNotFoundText: 'По ИНН/ПИНФЛ {id} данных нет. Проверьте номер; если он верный — повторите позже (источник данных — информационные системы НК).',
    errAuthMissing: 'Не переданы токены',
    errAuthMissingText: 'API не получил Partner-Authorization и/или user-key. Проверьте настройки.',
    errAuthExpired: 'Токен пользователя недействителен',
    errAuthExpiredText: 'user-key истёк (действует 6 часов) или неверен. Получите новый в «Настройках».',
    errAuth: 'Ошибка авторизации',
    errAuthText: 'Проверьте Partner-Authorization и user-key. Если ошибка повторяется — обратитесь к аккаунт-менеджеру Didox.',
    errForbidden: 'Доступ запрещён',
    errForbiddenText: 'Партнёрский токен недействителен или у него нет доступа к этому методу.',
    errValidation: 'Запрос отклонён',
    errValidationText: 'API отклонил запрос (код {status}).',
    errRateLimit: 'Слишком много запросов',
    errRateLimitText: 'Подождите немного и повторите.',
    errServer: 'Ошибка на стороне API',
    errServerText: 'Код {status}. Возможно, организация не найдена или источник данных НК временно недоступен. Повторите позже.',
    errOther: 'Неожиданный ответ API',
    errOtherText: 'Код {status}.',
    errTimeout: 'Превышено время ожидания',
    errTimeoutText: 'API не ответил за {sec} с. Повторите позже.',
    errOffline: 'Нет подключения к интернету',
    errOfflineText: 'Проверьте соединение и повторите.',
    errCors: 'Браузер заблокировал запрос (CORS)',
    errCorsText: 'Сервер доступен, но не разрешает запросы с этого сайта ({origin}). Попросите владельца API разрешить этот адрес или используйте прокси (см. README).',
    errNetwork: 'Сетевая ошибка',
    errNetworkText: 'Не удалось связаться с {host}. Проверьте адрес API и подключение. Если адрес верный, возможна блокировка CORS (см. README).',
    errBadJson: 'Некорректный ответ',
    errBadJsonText: 'API вернул ответ, который не является JSON.',
    serverSaid: 'Ответ сервера: ',
  },
  uz: {
    title: 'Kontragentni tekshirish',
    settings: 'Sozlamalar',
    settingsTitle: 'API sozlamalari',
    securityNote: "Tokenlar faqat shu brauzerning localStorage'ida saqlanadi va faqat ko'rsatilgan API manziliga yuboriladi. Sayt statik — serverda hech narsa saqlanmaydi. Begona kompyuterda foydalanmang.",
    apiUrl: 'API manzili',
    customUrl: "O'z manzilingiz (proksi)",
    customUrlLabel: "O'z manzilingiz, masalan Cloudflare Worker",
    partnerHint: '(Didox hamkorlik tokeni)',
    userKeyHint: '(foydalanuvchi tokeni, 6 soat amal qiladi)',
    save: 'Saqlash',
    clear: "Tokenlarni o'chirish",
    saved: 'Saqlandi',
    cleared: "Tokenlar o'chirildi",
    loginTitle: "STIR/JSHSHIR va Didox paroli orqali user-key olish",
    loginWarn: "Parol saqlanmaydi. Diqqat: daqiqasiga 3 ta noto'g'ri urinish kirishni 10 daqiqaga, 25 ta — butunlay bloklaydi.",
    loginTin: 'Sizning STIR / JSHSHIR',
    loginPassword: 'Didox paroli',
    loginBtn: 'Token olish',
    loginBusy: 'Kirilmoqda…',
    loginOk: 'Tayyor: user-key olindi va saqlandi ({name}).',
    loginNeedPartner: "Avval Partner-Authorization ni kiriting.",
    loginNeedFields: 'STIR/JSHSHIR (9 yoki 14 raqam) va parolni kiriting.',
    loginBadPassword: "STIR/JSHSHIR yoki parol noto'g'ri.",
    loginNotRegistered: "Foydalanuvchi Didox'da ro'yxatdan o'tmagan.",
    loginLocked: "Hisob bloklangan. Didox qo'llab-quvvatlash xizmatiga murojaat qiling.",
    keyValidUntil: 'Token parol orqali olingan, {time} gacha amal qiladi.',
    keyExpired: "Token muddati tugagan ({time}). Yangisini oling.",
    inputLabel: 'STIR (9 raqam) yoki JSHSHIR (14 raqam)',
    check: 'Tekshirish',
    recent: "So'nggilar:",
    loading: "API'ga so'rov…",
    details: "Ma'lumotlar",
    showJson: "JSON'ni ko'rsatish",
    hideJson: "JSON'ni yashirish",
    footer: "Ma'lumotlar: Didox API, GET /v1/utils/info/{STIR|JSHSHIR}.",
    serviceFieldsNote: "isItd va VATRegSimplified maydonlari Didox hujjatlarida xizmat maydonlari deb belgilangan va ogohlantirishsiz o'zgarishi mumkin.",
    yes: 'Ha',
    no: "Yo'q",
    noData: "Ma'lumot yo'q",
    typeInn: 'STIR — yuridik shaxs (9 raqam)',
    typePinfl: 'JSHSHIR — jismoniy shaxs (14 raqam)',
    detectedPrefix: 'Aniqlandi: ',
    errEmpty: 'STIR yoki JSHSHIR kiriting.',
    errDigits: 'Faqat raqamlar kiritilishi mumkin.',
    errLength: "Uzunlik noto'g'ri: {n} raqam. 9 (STIR) yoki 14 (JSHSHIR) bo'lishi kerak.",
    typing: 'Kiritilgan raqamlar: {n}',
    errTitle: 'Xato',
    errNoTokens: "Tokenlar ko'rsatilmagan",
    errNoTokensText: "«Sozlamalar»ni oching va Partner-Authorization hamda user-key ni kiriting (yoki user-key ni parol orqali oling).",
    errBadUrl: "API manzili noto'g'ri",
    errBadUrlText: "Sozlamalarda https://… ko'rinishidagi to'g'ri manzilni kiriting.",
    errNotFound: 'Kontragent topilmadi',
    errNotFoundText: "{id} bo'yicha ma'lumot yo'q. Raqamni tekshiring; agar to'g'ri bo'lsa — keyinroq qayta urinib ko'ring.",
    errAuthMissing: 'Tokenlar yuborilmadi',
    errAuthMissingText: 'API Partner-Authorization va/yoki user-key ni olmadi. Sozlamalarni tekshiring.',
    errAuthExpired: 'Foydalanuvchi tokeni yaroqsiz',
    errAuthExpiredText: "user-key muddati tugagan (6 soat) yoki noto'g'ri. «Sozlamalar»da yangisini oling.",
    errAuth: 'Avtorizatsiya xatosi',
    errAuthText: "Partner-Authorization va user-key ni tekshiring. Xato takrorlansa — Didox menejeriga murojaat qiling.",
    errForbidden: 'Kirish taqiqlangan',
    errForbiddenText: "Hamkorlik tokeni yaroqsiz yoki bu metodga ruxsati yo'q.",
    errValidation: "So'rov rad etildi",
    errValidationText: "API so'rovni rad etdi (kod {status}).",
    errRateLimit: "So'rovlar juda ko'p",
    errRateLimitText: "Biroz kuting va qayta urinib ko'ring.",
    errServer: 'API tomonida xato',
    errServerText: "Kod {status}. Tashkilot topilmagan yoki SQ ma'lumot manbasi vaqtincha ishlamayapti. Keyinroq urinib ko'ring.",
    errOther: 'Kutilmagan API javobi',
    errOtherText: 'Kod {status}.',
    errTimeout: 'Kutish vaqti tugadi',
    errTimeoutText: "API {sec} soniyada javob bermadi. Keyinroq urinib ko'ring.",
    errOffline: "Internetga ulanish yo'q",
    errOfflineText: "Ulanishni tekshirib, qayta urinib ko'ring.",
    errCors: "Brauzer so'rovni blokladi (CORS)",
    errCorsText: "Server ishlayapti, lekin bu saytdan ({origin}) so'rovlarga ruxsat bermaydi. API egasidan ruxsat so'rang yoki proksidan foydalaning (README).",
    errNetwork: 'Tarmoq xatosi',
    errNetworkText: "{host} bilan bog'lanib bo'lmadi. API manzili va ulanishni tekshiring. Manzil to'g'ri bo'lsa, CORS bloklagan bo'lishi mumkin (README).",
    errBadJson: "Noto'g'ri javob",
    errBadJsonText: 'API JSON bo\'lmagan javob qaytardi.',
    serverSaid: 'Server javobi: ',
  },
};

/* ------------------------------------------------------------
   Safe localStorage wrapper (private mode / blocked storage
   must never break the page).
   ------------------------------------------------------------ */
const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/* ------------------------------------------------------------
   DOM helpers & state
   ------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const K = CONFIG.storageKeys;

let lang = store.get(K.lang, 'ru') === 'uz' ? 'uz' : 'ru';
let lastResult = null;       // { id, data } of the last successful lookup
let currentRequest = null;   // AbortController of the in-flight lookup

function t(key, vars = {}) {
  const s = (I18N[lang] && I18N[lang][key]) || I18N.ru[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString(lang === 'uz' ? 'uz-UZ' : 'ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/* ------------------------------------------------------------
   Settings
   ------------------------------------------------------------ */
function getSettings() {
  const preset = store.get(K.preset, CONFIG.defaultPreset);
  const customUrl = store.get(K.customUrl, '');
  const baseUrl = preset === 'custom' ? customUrl : (CONFIG.apiPresets[preset] || CONFIG.apiPresets[CONFIG.defaultPreset]);
  return {
    preset,
    customUrl,
    baseUrl: String(baseUrl || '').trim().replace(/\/+$/, ''),
    partnerToken: store.get(K.partnerToken, ''),
    userKey: store.get(K.userKey, ''),
    userKeyIssuedAt: store.get(K.userKeyIssuedAt, null),
  };
}

function loadSettingsIntoForm() {
  const s = getSettings();
  $('apiPreset').value = s.preset in CONFIG.apiPresets || s.preset === 'custom' ? s.preset : CONFIG.defaultPreset;
  $('customUrl').value = s.customUrl;
  $('partnerToken').value = s.partnerToken;
  $('userKey').value = s.userKey;
  $('customUrlField').hidden = $('apiPreset').value !== 'custom';
  renderUserKeyInfo();
}

function renderUserKeyInfo() {
  const { userKey, userKeyIssuedAt } = getSettings();
  const el = $('userKeyInfo');
  el.className = 'small';
  if (!userKey || !userKeyIssuedAt) { el.textContent = ''; return; }
  const expires = userKeyIssuedAt + CONFIG.userKeyLifetimeMin * 60 * 1000;
  if (Date.now() < expires) {
    el.textContent = t('keyValidUntil', { time: fmtTime(expires) });
    el.classList.add('muted');
  } else {
    el.textContent = t('keyExpired', { time: fmtTime(expires) });
    el.classList.add('bad');
  }
}

function saveSettings(e) {
  e.preventDefault();
  const prev = getSettings();
  const userKey = $('userKey').value.trim();
  store.set(K.preset, $('apiPreset').value);
  store.set(K.customUrl, $('customUrl').value.trim());
  store.set(K.partnerToken, $('partnerToken').value.trim());
  store.set(K.userKey, userKey);
  // A manually changed key has an unknown issue time — drop the expiry hint.
  if (userKey !== prev.userKey) store.remove(K.userKeyIssuedAt);
  renderUserKeyInfo();
  flash($('settingsMsg'), t('saved'));
}

function clearTokens() {
  [K.partnerToken, K.userKey, K.userKeyIssuedAt].forEach(store.remove);
  $('partnerToken').value = '';
  $('userKey').value = '';
  renderUserKeyInfo();
  flash($('settingsMsg'), t('cleared'));
}

function flash(el, text) {
  el.textContent = text;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; }, 2500);
}

function openSettings(open = true) {
  $('settings').hidden = !open;
  $('settingsToggle').setAttribute('aria-expanded', String(open));
  if (open) loadSettingsIntoForm();
}

function isDidoxHost(url) {
  try { return /(^|\.)didox\.uz$/i.test(new URL(url).hostname); } catch { return false; }
}

/* ------------------------------------------------------------
   Optional login: POST /v1/auth/{taxId}/password/{locale}
   Returns { token, taxId, pinfl, name, ... }.
   ------------------------------------------------------------ */
async function login(e) {
  e.preventDefault();
  const msg = $('loginMsg');
  msg.className = 'small';
  const btn = e.submitter || $('loginForm').querySelector('button[type="submit"]');

  // Use what is currently typed in the form, even if not saved yet.
  const partnerToken = $('partnerToken').value.trim();
  const preset = $('apiPreset').value;
  const baseUrl = (preset === 'custom' ? $('customUrl').value : CONFIG.apiPresets[preset]).trim().replace(/\/+$/, '');
  const id = $('loginTin').value.replace(/\s+/g, '');
  const password = $('loginPassword').value;

  if (!partnerToken && isDidoxHost(baseUrl)) { msg.textContent = t('loginNeedPartner'); msg.classList.add('bad'); return; }
  if (!/^(\d{9}|\d{14})$/.test(id) || !password) { msg.textContent = t('loginNeedFields'); msg.classList.add('bad'); return; }

  btn.disabled = true;
  msg.textContent = t('loginBusy');
  try {
    const url = baseUrl + CONFIG.loginPath.replace('{id}', encodeURIComponent(id)).replace('{lang}', lang);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (partnerToken) headers[CONFIG.headers.partner] = partnerToken;
    const res = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify({ password }) });
    const { json, text } = await readBody(res);

    if (res.ok && json && json.token) {
      // Persist the form values together with the new key.
      store.set(K.preset, preset);
      store.set(K.customUrl, $('customUrl').value.trim());
      store.set(K.partnerToken, partnerToken);
      store.set(K.userKey, json.token);
      store.set(K.userKeyIssuedAt, Date.now());
      $('userKey').value = json.token;
      $('loginPassword').value = '';
      renderUserKeyInfo();
      msg.textContent = t('loginOk', { name: json.name || json.taxId || json.pinfl || id });
      msg.classList.add('ok');
      return;
    }

    const serverMsg = extractMessage(json, text);
    let human;
    if (res.status === 422 && /not registered/i.test(serverMsg)) human = t('loginNotRegistered');
    else if (res.status === 422) human = t('loginBadPassword');
    else if (res.status === 423) human = t('loginLocked');
    else if (res.status === 429) human = serverMsg || t('errRateLimit');
    else human = describeHttpError(res.status, serverMsg, id).text;
    msg.textContent = human + (serverMsg && human !== serverMsg ? ` (${serverMsg})` : '');
    msg.classList.add('bad');
  } catch (err) {
    const info = await describeFetchError(err, baseUrl);
    msg.textContent = `${info.title}. ${info.text}`;
    msg.classList.add('bad');
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Input validation
   ------------------------------------------------------------ */
function normalizeId(raw) {
  return String(raw || '').replace(/\s+/g, '');   // allow pasted spaces
}

function validateId(raw) {
  const id = normalizeId(raw);
  if (!id) return { ok: false, error: t('errEmpty') };
  if (!/^\d+$/.test(id)) return { ok: false, error: t('errDigits') };
  if (id.length === 9) return { ok: true, id, type: 'inn', typeLabel: t('typeInn') };
  if (id.length === 14) return { ok: true, id, type: 'pinfl', typeLabel: t('typePinfl') };
  return { ok: false, error: t('errLength', { n: id.length }) };
}

/** Live hint under the input: shows detected type while typing. */
function updateDetected(final = false) {
  const el = $('detected');
  const raw = $('taxId').value;
  const id = normalizeId(raw);
  el.className = 'detected';
  if (!id && !final) { el.textContent = ''; return; }
  const v = validateId(raw);
  if (v.ok) {
    el.textContent = t('detectedPrefix') + v.typeLabel;
    el.classList.add('is-ok');
  } else if (!final && /^\d+$/.test(id) && id.length < 14) {
    el.textContent = t('typing', { n: id.length });   // still typing, don't nag
  } else {
    el.textContent = v.error;
    el.classList.add('is-bad');
  }
}

/* ------------------------------------------------------------
   HTTP helpers
   ------------------------------------------------------------ */
async function fetchWithTimeout(url, options = {}, controller = new AbortController()) {
  const timer = setTimeout(() => controller.abort('timeout'), CONFIG.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

/** Read the body once; parse JSON when possible (errors are often plain text). */
async function readBody(res) {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { json, text };
}

/** Pull a readable message out of Didox's various error formats (A, B, C, plain text). */
function extractMessage(json, text) {
  if (json && typeof json === 'object') {
    if (json.error && typeof json.error === 'object' && json.error.message) return String(json.error.message);
    if (typeof json.error === 'string') return json.error;
    if (typeof json.message === 'string') return json.message;
    // Validation format: { field: ["msg"] }
    const firstArr = Object.values(json).find((v) => Array.isArray(v) && v.length);
    if (firstArr) return String(firstArr[0]);
  }
  if (typeof json === 'string') return json;
  const plain = String(text || '').trim();
  if (plain.startsWith('<')) return '';            // HTML error page — not useful
  return plain.slice(0, 300);
}

/** Map an HTTP status (+ server text) to a human-readable Russian/Uzbek message. */
function describeHttpError(status, serverMsg, id) {
  const m = String(serverMsg || '');
  if (status === 401) {
    if (/no user key|partner token passed/i.test(m)) return { title: t('errAuthMissing'), text: t('errAuthMissingText'), openSettings: true };
    if (/invalid user key/i.test(m)) return { title: t('errAuthExpired'), text: t('errAuthExpiredText'), openSettings: true };
    return { title: t('errAuth'), text: t('errAuthText'), openSettings: true };
  }
  if (status === 403) return { title: t('errForbidden'), text: t('errForbiddenText'), openSettings: true };
  if (status === 404) return { title: t('errNotFound'), text: t('errNotFoundText', { id }) };
  if (status === 429) return { title: t('errRateLimit'), text: t('errRateLimitText') };
  if (status === 400 || status === 422) {
    if (/not found|не найден|topilmadi/i.test(m)) return { title: t('errNotFound'), text: t('errNotFoundText', { id }) };
    return { title: t('errValidation'), text: t('errValidationText', { status }) };
  }
  if (status >= 500) return { title: t('errServer'), text: t('errServerText', { status }) };
  return { title: t('errOther'), text: t('errOtherText', { status }) };
}

/**
 * fetch() rejected: timeout, offline, CORS or plain network failure.
 * Browsers hide the reason, so to tell CORS apart we send a `no-cors` probe:
 * if the server answers it (opaque response), the host is reachable and the
 * original failure was almost certainly CORS.
 */
async function describeFetchError(err, baseUrl) {
  if (err && (err.name === 'AbortError' || err === 'timeout')) {
    return { title: t('errTimeout'), text: t('errTimeoutText', { sec: CONFIG.timeoutMs / 1000 }) };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { title: t('errOffline'), text: t('errOfflineText') };
  }
  let host = baseUrl;
  try { host = new URL(baseUrl).host; } catch { /* keep raw */ }
  try {
    const probe = new AbortController();
    const timer = setTimeout(() => probe.abort(), 8000);
    await fetch(baseUrl + '/', { mode: 'no-cors', cache: 'no-store', signal: probe.signal });
    clearTimeout(timer);
    return { title: t('errCors'), text: t('errCorsText', { origin: location.origin }) };
  } catch {
    return { title: t('errNetwork'), text: t('errNetworkText', { host }) };
  }
}

/* ------------------------------------------------------------
   Main lookup
   ------------------------------------------------------------ */
async function check(rawId) {
  const v = validateId(rawId);
  updateDetected(true);
  if (!v.ok) { showError(t('errTitle'), v.error); return; }

  const s = getSettings();
  let url;
  try {
    url = new URL(s.baseUrl + CONFIG.infoPath.replace('{id}', encodeURIComponent(v.id)));
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('insecure');
  } catch {
    showError(t('errBadUrl'), t('errBadUrlText'));
    openSettings(true);
    return;
  }

  // Didox itself needs both tokens; a proxy (custom URL) may hold them server-side.
  if (isDidoxHost(s.baseUrl) && (!s.partnerToken || !s.userKey)) {
    showError(t('errNoTokens'), t('errNoTokensText'));
    openSettings(true);
    return;
  }

  // Cancel a previous in-flight request, if any.
  if (currentRequest) currentRequest.abort('superseded');
  const controller = new AbortController();
  currentRequest = controller;

  const headers = { Accept: 'application/json', 'Accept-Language': lang };
  if (s.partnerToken) headers[CONFIG.headers.partner] = s.partnerToken;
  if (s.userKey) headers[CONFIG.headers.user] = s.userKey;

  setLoading(true);
  hideError();
  $('result').hidden = true;

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET', headers }, controller);
    const { json, text } = await readBody(res);
    if (controller !== currentRequest) return;   // a newer request took over

    if (!res.ok) {
      const serverMsg = extractMessage(json, text);
      const info = describeHttpError(res.status, serverMsg, v.id);
      showError(info.title, info.text, serverMsg);
      if (info.openSettings) openSettings(true);
      return;
    }

    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      showError(t('errBadJson'), t('errBadJsonText'), String(text).slice(0, 300));
      return;
    }

    // 200 with an error envelope, or an empty record → treat as "not found".
    const data = json.data && typeof json.data === 'object' && !json.tin && !json.name ? json.data : json;
    if (json.error || (!data.name && !data.shortName && !data.tin && !data.fullName)) {
      const serverMsg = extractMessage(json, text);
      showError(t('errNotFound'), t('errNotFoundText', { id: v.id }), serverMsg);
      return;
    }

    lastResult = { id: v.id, type: v.type, data, raw: json };
    renderResult();
    addToHistory(v.id, data.shortName || data.name || '');
  } catch (err) {
    if (controller !== currentRequest) return;   // aborted on purpose by a newer request
    const info = await describeFetchError(err, s.baseUrl);
    showError(info.title, info.text);
  } finally {
    if (controller === currentRequest) {
      currentRequest = null;
      setLoading(false);
    }
  }
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */
function setLoading(on) {
  $('loading').hidden = !on;
  $('checkBtn').disabled = on;
}

function showError(title, text, serverMsg = '') {
  $('errorTitle').textContent = title;
  $('errorText').textContent = text + (serverMsg ? `\n${t('serverSaid')}${serverMsg}` : '');
  $('errorText').style.whiteSpace = 'pre-line';
  $('error').hidden = false;
  $('result').hidden = true;
}

function hideError() { $('error').hidden = true; }

/** Normalise a raw value into true / false / null ("no data"). */
function toBool(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function renderResult() {
  if (!lastResult) return;
  const { id, type, data, raw } = lastResult;

  $('resName').textContent = data.name || data.fullName || data.shortName || id;
  $('resSub').textContent = `${type === 'pinfl' ? t('typePinfl') : t('typeInn')} · ${id}`;

  // Status cards
  const grid = $('statusGrid');
  grid.replaceChildren();
  for (const f of CONFIG.statusFields) {
    const b = toBool(data[f.key]);
    const card = document.createElement('div');
    card.className = 'status ' + (b === true ? 'is-yes' : b === false ? 'is-no' : 'is-nodata');

    const label = document.createElement('span');
    label.className = 'status__label';
    label.textContent = f.label[lang] || f.label.ru;

    const value = document.createElement('span');
    value.className = 'status__value';
    value.textContent = b === true ? t('yes') : b === false ? t('no') : t('noData');

    const field = document.createElement('span');
    field.className = 'status__field';
    field.textContent = f.key;

    card.append(label, value, field);
    grid.append(card);
  }

  // Details list (only fields present & non-empty)
  const dl = $('details');
  dl.replaceChildren();
  for (const f of CONFIG.detailFields) {
    const val = data[f.key];
    if (val === undefined || val === null || val === '') continue;
    let shown = String(val);
    if (f.format === 'bool') {
      const b = toBool(val);
      shown = b === true ? t('yes') : b === false ? t('no') : shown;
    } else if (f.format === 'vatStatus') {
      const st = CONFIG.vatStatus[val];
      shown = st ? `${val} — ${st[lang] || st.ru}` : shown;
    }
    const dt = document.createElement('dt');
    dt.textContent = f.label[lang] || f.label.ru;
    const dd = document.createElement('dd');
    dd.textContent = shown;
    dl.append(dt, dd);
  }

  $('json').textContent = JSON.stringify(raw, null, 2);
  $('result').hidden = false;
}

function toggleJson() {
  const pre = $('json');
  pre.hidden = !pre.hidden;
  $('jsonToggle').setAttribute('aria-expanded', String(!pre.hidden));
  $('jsonToggle').textContent = pre.hidden ? t('showJson') : t('hideJson');
}

/* ------------------------------------------------------------
   History (last N searches, localStorage)
   ------------------------------------------------------------ */
function getHistory() {
  const h = store.get(K.history, []);
  return Array.isArray(h) ? h.filter((x) => x && /^\d{9}$|^\d{14}$/.test(x.id)) : [];
}

function addToHistory(id, name) {
  const h = getHistory().filter((x) => x.id !== id);
  h.unshift({ id, name: String(name).slice(0, 80), ts: Date.now() });
  store.set(K.history, h.slice(0, CONFIG.historySize));
  renderHistory();
}

function renderHistory() {
  const h = getHistory();
  const list = $('historyList');
  list.replaceChildren();
  $('history').hidden = h.length === 0;
  for (const item of h) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.title = item.name ? `${item.id} — ${item.name}` : item.id;
    const b = document.createElement('b');
    b.textContent = item.id;
    btn.append(b);
    if (item.name) btn.append(' · ' + item.name);
    btn.addEventListener('click', () => {
      $('taxId').value = item.id;
      check(item.id);
    });
    li.append(btn);
    list.append(li);
  }
}

/* ------------------------------------------------------------
   Language switch
   ------------------------------------------------------------ */
function applyLang(newLang) {
  lang = newLang === 'uz' ? 'uz' : 'ru';
  store.set(K.lang, lang);
  document.documentElement.lang = lang;
  document.title = `${t('title')} — Didox`;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('.lang__btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
  $('jsonToggle').textContent = $('json').hidden ? t('showJson') : t('hideJson');
  updateDetected(false);
  renderUserKeyInfo();
  if (lastResult && !$('result').hidden) renderResult();
}

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // Submit via button or Enter (native form submit).
  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    check($('taxId').value);
  });
  $('taxId').addEventListener('input', () => updateDetected(false));

  $('settingsToggle').addEventListener('click', () => openSettings($('settings').hidden));
  $('apiPreset').addEventListener('change', () => {
    $('customUrlField').hidden = $('apiPreset').value !== 'custom';
  });
  $('settingsForm').addEventListener('submit', saveSettings);
  $('clearSettings').addEventListener('click', clearTokens);
  $('loginForm').addEventListener('submit', login);

  $('jsonToggle').addEventListener('click', toggleJson);
  document.querySelectorAll('.lang__btn').forEach((b) => {
    b.addEventListener('click', () => applyLang(b.dataset.lang));
  });

  applyLang(lang);
  loadSettingsIntoForm();
  renderHistory();

  // First visit without tokens → show settings straight away.
  const s = getSettings();
  if (isDidoxHost(s.baseUrl) && (!s.partnerToken || !s.userKey)) openSettings(true);

  $('taxId').focus();
});
