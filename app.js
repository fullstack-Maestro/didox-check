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
  loginPath: '/v1/auth/{id}/password/{lang}',      // login by password
  eimzoLoginPath: '/v1/auth/{id}/token/{lang}',    // login by ЭЦП signature
  timestampPath: '/v1/dsvs/timestamp',             // attaches a timestamp to an E-IMZO signature

  // E-IMZO API keys as [domain, key, ...]. These two are the public keys for local
  // use from the official e-imzo-client.js. A key for your own domain (e.g.
  // <login>.github.io) is issued by the E-IMZO developers — add it here or paste
  // it in the settings panel.
  eimzoApiKeys: [
    'localhost', '96D0C1491615C82B9A54D9989779DF825B690748224C2B04F500F370D51827CE2644D8D4A82C18184D73AB8530BB8ED537269603F61DB0D03D2104ABF789970B',
    '127.0.0.1', 'A7BCFA5D490B351BE0754130DF03A068F855DB4333D43921125B9CF2670EF6A40370C646B90401955E1F7BC9CDBF59CE0B2C5467D820BE189C845D0B79CFC96F',
  ],
  eimzoLocalUrl: 'http://localhost:8000/',   // suggested when this domain has no E-IMZO key

  // Auth headers. Only user-key is required for /v1/utils/info;
  // Partner-Authorization is optional and sent only when filled in.
  headers: {
    partner: 'Partner-Authorization',
    user: 'user-key',
  },
  userKeyLifetimeMin: 360,  // user tokens are valid for 360 minutes
  refreshMarginMin: 5,      // auto-login this many minutes before the token expires
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
    autoLogin: 'didox.autoLogin',          // { method: 'password', id, password } | { method: 'eimzo', serialNumber, loginId, label }
    eimzoDomainKey: 'didox.eimzoDomainKey',
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
    partnerHint: '(необязательно — партнёрский токен от Didox)',
    userKeyHint: '(токен пользователя, действует 6 часов)',
    save: 'Сохранить',
    clear: 'Удалить всё сохранённое',
    saved: 'Сохранено',
    cleared: 'Токены и пароль удалены',
    loginTitle: 'Получить user-key автоматически',
    loginWarn: 'Внимание: у Didox жёсткая защита от перебора — 3 неверные попытки в минуту блокируют вход на 10 минут, 25 — навсегда.',
    tabPassword: 'Логин и пароль',
    loginRemember: 'Запомнить пароль на этом устройстве и входить автоматически, когда токен истекает',
    loginRememberNote: 'Пароль хранится в localStorage браузера в открытом виде. Включайте только на своём личном компьютере. Если автовход получит отказ (неверный пароль, блокировка), пароль сразу удаляется, чтобы не попасть под блокировку.',
    autoOff: 'Отключить автовход',
    autoNone: 'Автовход выключен — user-key нужно получать вручную.',
    autoPassword: 'Автовход включён: по паролю ({id}).',
    autoEimzo: 'Автовход включён: ЭЦП {label}.',
    autoLoginBusy: 'Вход в Didox…',
    autoLoginEimzoBusy: 'Подтвердите вход в окне E-IMZO…',
    autoLoginFailed: 'Не удалось войти автоматически',
    autoLoginDisabled: 'Автовход отключён, сохранённый пароль удалён: {reason}',
    eimzoNote: 'Нужно установленное и запущенное приложение E-IMZO (e-imzo.uz). Пароль ключа вводится в окне E-IMZO — сайт его не видит.',
    eimzoFind: 'Найти ключи ЭЦП',
    eimzoKey: 'Ключ ЭЦП',
    eimzoRemember: 'Входить этим ключом автоматически, когда токен истекает (откроется окно E-IMZO)',
    eimzoLogin: 'Войти с ЭЦП',
    eimzoDomainTitle: 'API-ключ E-IMZO для этого сайта',
    eimzoDomainNote: 'E-IMZO работает только с сайтами, для домена которых выдан API-ключ. Для localhost ключ встроен. Для этого домена ключ нужно получить у разработчиков E-IMZO (e-imzo.uz) и вставить сюда.',
    eimzoDomain: 'Домен:',
    eimzoSearching: 'Подключение к E-IMZO…',
    eimzoFound: 'Найдено ключей: {n}',
    eimzoNoKeys: 'E-IMZO не нашёл ключей .pfx. Вставьте флешку с ключом и нажмите «Найти» ещё раз.',
    eimzoSigning: 'Введите пароль ключа в окне E-IMZO…',
    eimzoNotRunning: 'E-IMZO не отвечает. Убедитесь, что приложение E-IMZO установлено и запущено (значок в трее), и разрешите браузеру доступ к локальной сети, если он спросит.',
    eimzoNoApiKey: 'E-IMZO не принимает запросы с домена {host}: для него нет API-ключа. Получите ключ у разработчиков E-IMZO и вставьте его ниже, или откройте сайт локально через localhost (см. README).',
    eimzoNoKeyWarn: 'Для домена {host} нет API-ключа E-IMZO, поэтому вход по ЭЦП здесь не сработает. Войдите по паролю, вставьте API-ключ домена ниже или запустите сайт локально (python3 -m http.server 8000) и откройте:',
    eimzoOld: 'Установлена старая версия E-IMZO ({v}). Обновите её на e-imzo.uz.',
    eimzoTimeout: 'E-IMZO не ответил вовремя. Повторите.',
    eimzoFailed: 'E-IMZO вернул ошибку: {reason}',
    eimzoKeyMissing: 'Сохранённый ключ ЭЦП не найден. Вставьте флешку с ключом или выберите ключ заново.',
    eimzoKeyExpired: 'срок истёк',
    eimzoTimestampFailed: 'Didox не принял подпись (timestamp).',
    loginTin: 'Ваш ИНН / ПИНФЛ',
    loginPassword: 'Пароль Didox',
    loginBtn: 'Получить токен',
    loginBusy: 'Вход…',
    loginOk: 'Готово: user-key получен и сохранён ({name}).',
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
    errNoTokens: 'Не указан user-key',
    errNoTokensText: 'Откройте «Настройки» и вставьте user-key (или получите его по ИНН/ПИНФЛ и паролю).',
    errBadUrl: 'Неверный API-адрес',
    errBadUrlText: 'Укажите корректный адрес вида https://… в настройках.',
    errNotFound: 'Контрагент не найден',
    errNotFoundText: 'По ИНН/ПИНФЛ {id} данных нет. Проверьте номер; если он верный — повторите позже (источник данных — информационные системы НК).',
    errAuthMissing: 'Не переданы токены',
    errAuthMissingText: 'API не получил user-key. Проверьте настройки.',
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
    partnerHint: '(ixtiyoriy — Didox hamkorlik tokeni)',
    userKeyHint: '(foydalanuvchi tokeni, 6 soat amal qiladi)',
    save: 'Saqlash',
    clear: "Saqlanganlarni o'chirish",
    saved: 'Saqlandi',
    cleared: "Tokenlar va parol o'chirildi",
    loginTitle: 'user-key ni avtomatik olish',
    loginWarn: "Diqqat: daqiqasiga 3 ta noto'g'ri urinish kirishni 10 daqiqaga, 25 ta — butunlay bloklaydi.",
    tabPassword: 'Login va parol',
    loginRemember: "Parolni shu qurilmada eslab qolish va token muddati tugaganda avtomatik kirish",
    loginRememberNote: "Parol brauzer localStorage'ida ochiq holda saqlanadi. Faqat shaxsiy kompyuteringizda yoqing. Avtomatik kirish rad etilsa (noto'g'ri parol, bloklash), parol darhol o'chiriladi.",
    autoOff: "Avtomatik kirishni o'chirish",
    autoNone: "Avtomatik kirish o'chirilgan — user-key ni qo'lda olish kerak.",
    autoPassword: 'Avtomatik kirish yoqilgan: parol orqali ({id}).',
    autoEimzo: 'Avtomatik kirish yoqilgan: ERI {label}.',
    autoLoginBusy: 'Didox tizimiga kirilmoqda…',
    autoLoginEimzoBusy: 'E-IMZO oynasida kirishni tasdiqlang…',
    autoLoginFailed: "Avtomatik kirib bo'lmadi",
    autoLoginDisabled: "Avtomatik kirish o'chirildi, saqlangan parol o'chirildi: {reason}",
    eimzoNote: "E-IMZO ilovasi (e-imzo.uz) o'rnatilgan va ishga tushirilgan bo'lishi kerak. Kalit paroli E-IMZO oynasida kiritiladi — sayt uni ko'rmaydi.",
    eimzoFind: 'ERI kalitlarini topish',
    eimzoKey: 'ERI kaliti',
    eimzoRemember: "Token muddati tugaganda shu kalit bilan avtomatik kirish (E-IMZO oynasi ochiladi)",
    eimzoLogin: 'ERI bilan kirish',
    eimzoDomainTitle: 'Bu sayt uchun E-IMZO API kaliti',
    eimzoDomainNote: "E-IMZO faqat API kaliti berilgan domenlar bilan ishlaydi. localhost uchun kalit o'rnatilgan. Bu domen uchun kalitni E-IMZO ishlab chiquvchilaridan (e-imzo.uz) olib, shu yerga kiriting.",
    eimzoDomain: 'Domen:',
    eimzoSearching: 'E-IMZO ga ulanilmoqda…',
    eimzoFound: 'Topilgan kalitlar: {n}',
    eimzoNoKeys: "E-IMZO .pfx kalitlarini topmadi. Kalitli fleshkani ulang va qayta «Topish»ni bosing.",
    eimzoSigning: 'E-IMZO oynasida kalit parolini kiriting…',
    eimzoNotRunning: "E-IMZO javob bermayapti. E-IMZO ilovasi o'rnatilgan va ishga tushirilganini tekshiring, brauzer so'rasa lokal tarmoqqa ruxsat bering.",
    eimzoNoApiKey: "E-IMZO {host} domenidan so'rovlarni qabul qilmaydi: API kaliti yo'q. Kalitni E-IMZO ishlab chiquvchilaridan oling yoki saytni localhost orqali oching (README).",
    eimzoNoKeyWarn: "{host} domeni uchun E-IMZO API kaliti yo'q, shuning uchun bu yerda ERI bilan kirish ishlamaydi. Parol bilan kiring, domen API kalitini quyida kiriting yoki saytni lokal ishga tushiring (python3 -m http.server 8000) va oching:",
    eimzoOld: "E-IMZO eski versiyasi o'rnatilgan ({v}). e-imzo.uz saytida yangilang.",
    eimzoTimeout: "E-IMZO o'z vaqtida javob bermadi. Qayta urinib ko'ring.",
    eimzoFailed: 'E-IMZO xato qaytardi: {reason}',
    eimzoKeyMissing: "Saqlangan ERI kaliti topilmadi. Kalitli fleshkani ulang yoki kalitni qaytadan tanlang.",
    eimzoKeyExpired: 'muddati tugagan',
    eimzoTimestampFailed: 'Didox imzoni (timestamp) qabul qilmadi.',
    loginTin: 'Sizning STIR / JSHSHIR',
    loginPassword: 'Didox paroli',
    loginBtn: 'Token olish',
    loginBusy: 'Kirilmoqda…',
    loginOk: 'Tayyor: user-key olindi va saqlandi ({name}).',
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
    errNoTokens: "user-key ko'rsatilmagan",
    errNoTokensText: "«Sozlamalar»ni oching va user-key ni kiriting (yoki uni STIR/JSHSHIR va parol orqali oling).",
    errBadUrl: "API manzili noto'g'ri",
    errBadUrlText: "Sozlamalarda https://… ko'rinishidagi to'g'ri manzilni kiriting.",
    errNotFound: 'Kontragent topilmadi',
    errNotFoundText: "{id} bo'yicha ma'lumot yo'q. Raqamni tekshiring; agar to'g'ri bo'lsa — keyinroq qayta urinib ko'ring.",
    errAuthMissing: 'Tokenlar yuborilmadi',
    errAuthMissingText: 'API user-key ni olmadi. Sozlamalarni tekshiring.',
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

  const auto = getAutoLogin();
  $('loginRemember').checked = auto?.method === 'password';
  if (auto?.method === 'password' && !$('loginTin').value) $('loginTin').value = auto.id;
  $('eimzoDomainName').textContent = location.hostname || 'file://';
  $('eimzoDomainKey').value = store.get(K.eimzoDomainKey, '');
  renderAutoLoginInfo();
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
  [K.partnerToken, K.userKey, K.userKeyIssuedAt, K.autoLogin].forEach(store.remove);
  $('partnerToken').value = '';
  $('userKey').value = '';
  $('loginPassword').value = '';
  $('loginRemember').checked = false;
  renderUserKeyInfo();
  renderAutoLoginInfo();
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
   Getting a user-key
   - by password: POST /v1/auth/{id}/password/{lang}  { password }
   - by ЭЦП:      E-IMZO signs base64(id) → POST /v1/dsvs/timestamp
                  → POST /v1/auth/{id}/token/{lang}  { signature }
   Both return { token, ... }. Optionally remembered for auto-login.
   ------------------------------------------------------------ */

/** A login failure with a ready-to-show message. rejected = Didox refused the credentials. */
class AuthError extends Error {
  constructor(message, { rejected = false } = {}) {
    super(message);
    this.rejected = rejected;
  }
}

let autoLoginPromise = null;   // shared while an auto-login is running
let eimzoKeys = [];            // keys from the last E-IMZO listing

/** API address + partner token as currently typed in the form (falls back to saved). */
function formApi() {
  const preset = $('apiPreset').value;
  const baseUrl = (preset === 'custom' ? $('customUrl').value : CONFIG.apiPresets[preset]) || getSettings().baseUrl;
  return { baseUrl: baseUrl.trim().replace(/\/+$/, ''), partnerToken: $('partnerToken').value.trim() };
}

/** POST JSON to Didox; network problems become AuthError with a readable text. */
async function postJson(api, path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Language': lang };
  if (api.partnerToken) headers[CONFIG.headers.partner] = api.partnerToken;
  let res;
  try {
    res = await fetchWithTimeout(api.baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    const info = await describeFetchError(err, api.baseUrl);
    throw new AuthError(`${info.title}. ${info.text}`);
  }
  const { json, text } = await readBody(res);
  return { res, json, text, serverMsg: extractMessage(json, text) };
}

/** Turn a failed auth response into an AuthError. */
function authFailure(res, serverMsg, id) {
  let human;
  if (res.status === 422 && /not registered/i.test(serverMsg)) human = t('loginNotRegistered');
  else if (res.status === 422) human = t('loginBadPassword');
  else if (res.status === 423) human = t('loginLocked');
  else if (res.status === 429) human = serverMsg || t('errRateLimit');
  else human = describeHttpError(res.status, serverMsg, id).text;
  const detail = serverMsg && human !== serverMsg ? ` (${serverMsg})` : '';
  return new AuthError(human + detail, { rejected: res.status >= 400 && res.status < 500 });
}

function authPath(template, id) {
  return template.replace('{id}', encodeURIComponent(id)).replace('{lang}', lang);
}

/** Save a fresh user-key together with its issue time. */
function storeUserKey(token) {
  store.set(K.userKey, token);
  store.set(K.userKeyIssuedAt, Date.now());
  if ($('userKey')) $('userKey').value = token;
  renderUserKeyInfo();
}

async function loginWithPassword(api, id, password) {
  const { res, json, serverMsg } = await postJson(api, authPath(CONFIG.loginPath, id), { password });
  if (res.ok && json && json.token) {
    storeUserKey(json.token);
    return { name: json.name || json.taxId || json.pinfl || id };
  }
  throw authFailure(res, serverMsg, id);
}

/** Full E-IMZO login with a key object from Eimzo.listKeys(). */
async function loginWithEimzo(api, key, onStatus = () => {}) {
  const id = key.loginId;
  onStatus(t('eimzoSigning'));
  let signed;
  try {
    signed = await Eimzo.sign(key, btoa(id));
  } catch (e) {
    throw eimzoAuthError(e);
  }

  // Didox attaches a timestamp to the signature.
  const ts = await postJson(api, CONFIG.timestampPath, { pkcs7: signed.pkcs7_64, signatureHex: signed.signature_hex });
  const stamp = ts.json && ts.json.timeStampTokenB64;
  if (!ts.res.ok || !stamp) {
    throw new AuthError(t('eimzoTimestampFailed') + (ts.serverMsg ? ` (${ts.serverMsg})` : ''));
  }

  const { res, json, serverMsg } = await postJson(api, authPath(CONFIG.eimzoLoginPath, id), { signature: stamp });
  if (res.ok && json && json.token) {
    storeUserKey(json.token);
    return { name: json.name || key.org || key.cn || id };
  }
  throw authFailure(res, serverMsg, id);
}

/** Map an EimzoError to an AuthError with a human message. */
function eimzoAuthError(e) {
  if (!(e instanceof EimzoError)) return new AuthError(String(e && e.message || e));
  switch (e.code) {
    case 'connect': return new AuthError(t('eimzoNotRunning'));
    case 'apikey':  return new AuthError(t('eimzoNoApiKey', { host: location.hostname || 'file://' }));
    case 'version': return new AuthError(t('eimzoOld', { v: e.reason }));
    case 'timeout': return new AuthError(t('eimzoTimeout'));
    default:        return new AuthError(t('eimzoFailed', { reason: e.reason || '—' }));
  }
}

/** Built-in E-IMZO keys plus the one pasted for the current domain. */
function eimzoApiKeys() {
  const keys = [...CONFIG.eimzoApiKeys];
  const own = store.get(K.eimzoDomainKey, '');
  if (own && location.hostname) keys.push(location.hostname, own);
  return keys;
}

/** True if E-IMZO has a key for the current domain (built-in or pasted). */
function eimzoHasDomainKey() {
  const keys = eimzoApiKeys();
  for (let i = 0; i < keys.length; i += 2) if (keys[i] === location.hostname && keys[i + 1]) return true;
  return false;
}

/** Warn on the E-IMZO tab before the user tries a login that cannot work here. */
function renderEimzoDomainWarn() {
  const el = $('eimzoNoKeyWarn');
  el.hidden = eimzoHasDomainKey();
  if (el.hidden) return;
  const link = document.createElement('a');
  link.href = CONFIG.eimzoLocalUrl;
  link.textContent = CONFIG.eimzoLocalUrl;
  el.replaceChildren(t('eimzoNoKeyWarn', { host: location.hostname || 'file://' }) + ' ', link);
}

async function eimzoInit() {
  try {
    await Eimzo.init(eimzoApiKeys());
  } catch (e) {
    throw eimzoAuthError(e);
  }
}

function keyLabel(k) {
  const who = k.org ? `${k.cn} — ${k.org}` : k.cn;
  return `${who} (${k.loginId})`;
}

/* ---------- Auto-login ---------- */

function getAutoLogin() {
  const a = store.get(K.autoLogin, null);
  return a && (a.method === 'password' || a.method === 'eimzo') ? a : null;
}

/** True if the saved key is missing or (known to be) about to expire. */
function userKeyNeedsRefresh(s) {
  if (!s.userKey) return true;
  if (!s.userKeyIssuedAt) return false;   // pasted manually — rely on the 401 retry
  const ttl = (CONFIG.userKeyLifetimeMin - CONFIG.refreshMarginMin) * 60 * 1000;
  return Date.now() > s.userKeyIssuedAt + ttl;
}

/**
 * Get a new user-key with the remembered method. Runs at most one login at a time.
 * A rejected password is deleted immediately so we never hammer Didox's lockout.
 */
function runAutoLogin(onStatus = () => {}) {
  if (autoLoginPromise) return autoLoginPromise;
  const cfg = getAutoLogin();
  if (!cfg) return Promise.reject(new AuthError(t('errNoTokensText')));
  const s = getSettings();
  const api = { baseUrl: s.baseUrl, partnerToken: s.partnerToken };

  autoLoginPromise = (async () => {
    try {
      if (cfg.method === 'password') {
        onStatus(t('autoLoginBusy'));
        return await loginWithPassword(api, cfg.id, cfg.password);
      }
      onStatus(t('autoLoginEimzoBusy'));
      await eimzoInit();
      let keys;
      try { keys = await Eimzo.listKeys(); } catch (e) { throw eimzoAuthError(e); }
      const key = keys.find((k) => k.serialNumber === cfg.serialNumber);
      if (!key) throw new AuthError(t('eimzoKeyMissing'));
      return await loginWithEimzo(api, key, onStatus);
    } catch (e) {
      if (cfg.method === 'password' && e instanceof AuthError && e.rejected) {
        store.remove(K.autoLogin);
        renderAutoLoginInfo();
        throw new AuthError(t('autoLoginDisabled', { reason: e.message }));
      }
      throw e;
    }
  })().finally(() => { autoLoginPromise = null; });
  return autoLoginPromise;
}

function renderAutoLoginInfo() {
  const cfg = getAutoLogin();
  const el = $('autoLoginInfo');
  el.className = 'small ' + (cfg ? 'ok' : 'muted');
  if (!cfg) el.textContent = t('autoNone');
  else if (cfg.method === 'password') el.textContent = t('autoPassword', { id: cfg.id });
  else el.textContent = t('autoEimzo', { label: cfg.label });
  $('autoLoginOff').hidden = !cfg;
}

function disableAutoLogin() {
  store.remove(K.autoLogin);
  renderAutoLoginInfo();
}

/* ---------- Settings panel handlers ---------- */

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.className = 'small' + (kind ? ' ' + kind : '');
}

/** Save API address / partner token typed in the form before logging in with them. */
function persistApiFields() {
  store.set(K.preset, $('apiPreset').value);
  store.set(K.customUrl, $('customUrl').value.trim());
  store.set(K.partnerToken, $('partnerToken').value.trim());
}

async function onPasswordLogin(e) {
  e.preventDefault();
  const msg = $('loginMsg');
  const btn = $('loginForm').querySelector('button[type="submit"]');
  const id = normalizeId($('loginTin').value);
  const password = $('loginPassword').value;
  if (!/^(\d{9}|\d{14})$/.test(id) || !password) { setMsg(msg, t('loginNeedFields'), 'bad'); return; }

  btn.disabled = true;
  setMsg(msg, t('loginBusy'));
  try {
    persistApiFields();
    const r = await loginWithPassword(formApi(), id, password);
    if ($('loginRemember').checked) store.set(K.autoLogin, { method: 'password', id, password });
    else if (getAutoLogin()?.method === 'password') disableAutoLogin();
    $('loginPassword').value = '';
    renderAutoLoginInfo();
    setMsg(msg, t('loginOk', { name: r.name }), 'ok');
  } catch (err) {
    setMsg(msg, err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

async function onEimzoFind() {
  const msg = $('eimzoMsg');
  const btn = $('eimzoFind');
  btn.disabled = true;
  setMsg(msg, t('eimzoSearching'));
  try {
    await eimzoInit();
    try { eimzoKeys = await Eimzo.listKeys(); } catch (e) { throw eimzoAuthError(e); }
    renderEimzoKeys();
    setMsg(msg, eimzoKeys.length ? t('eimzoFound', { n: eimzoKeys.length }) : t('eimzoNoKeys'), eimzoKeys.length ? 'ok' : 'bad');
  } catch (err) {
    eimzoKeys = [];
    renderEimzoKeys();
    setMsg(msg, err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

function renderEimzoKeys() {
  const sel = $('eimzoKey');
  sel.replaceChildren();
  const saved = getAutoLogin();
  const now = Date.now();
  eimzoKeys.forEach((k, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const expired = k.validTo && k.validTo.getTime() < now;
    opt.textContent = keyLabel(k) + (expired ? ` — ${t('eimzoKeyExpired')}` : '');
    opt.disabled = !!expired;
    if (saved && saved.method === 'eimzo' && saved.serialNumber === k.serialNumber) opt.selected = true;
    sel.append(opt);
  });
  // Prefer the first usable key if the saved one isn't there.
  if (sel.selectedOptions[0]?.disabled) {
    const firstOk = [...sel.options].find((o) => !o.disabled);
    if (firstOk) firstOk.selected = true;
  }
  const has = eimzoKeys.length > 0;
  $('eimzoKeyField').hidden = !has;
  $('eimzoRememberRow').hidden = !has;
  $('eimzoLoginRow').hidden = !has;
}

async function onEimzoLogin() {
  const msg = $('eimzoMsg');
  const btn = $('eimzoLogin');
  const key = eimzoKeys[Number($('eimzoKey').value)];
  if (!key) return;
  btn.disabled = true;
  try {
    persistApiFields();
    await eimzoInit();
    const r = await loginWithEimzo(formApi(), key, (text) => setMsg(msg, text));
    if ($('eimzoRemember').checked) {
      store.set(K.autoLogin, { method: 'eimzo', serialNumber: key.serialNumber, loginId: key.loginId, label: keyLabel(key) });
    } else if (getAutoLogin()?.method === 'eimzo') {
      disableAutoLogin();
    }
    renderAutoLoginInfo();
    setMsg(msg, t('loginOk', { name: r.name }), 'ok');
  } catch (err) {
    setMsg(msg, err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

function saveEimzoDomainKey() {
  const v = $('eimzoDomainKey').value.trim();
  if (v) store.set(K.eimzoDomainKey, v); else store.remove(K.eimzoDomainKey);
  renderEimzoDomainWarn();
  flash($('eimzoMsg'), t('saved'));
}

function selectLoginTab(which) {
  const eimzo = which === 'eimzo';
  $('tabPassword').setAttribute('aria-selected', String(!eimzo));
  $('tabEimzo').setAttribute('aria-selected', String(eimzo));
  $('loginForm').hidden = eimzo;
  $('eimzoPanel').hidden = !eimzo;
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

  // Didox itself needs a user-key; a proxy (custom URL) may hold it server-side.
  const direct = isDidoxHost(s.baseUrl);
  const auto = direct ? getAutoLogin() : null;
  if (direct && !s.userKey && !auto) {
    showError(t('errNoTokens'), t('errNoTokensText'));
    openSettings(true);
    return;
  }

  // Cancel a previous in-flight request, if any.
  if (currentRequest) currentRequest.abort('superseded');
  const controller = new AbortController();
  currentRequest = controller;

  const fetchInfo = async () => {
    const cur = getSettings();
    const headers = { Accept: 'application/json', 'Accept-Language': lang };
    if (cur.partnerToken) headers[CONFIG.headers.partner] = cur.partnerToken;
    if (cur.userKey) headers[CONFIG.headers.user] = cur.userKey;
    const res = await fetchWithTimeout(url.toString(), { method: 'GET', headers }, controller);
    return { res, ...(await readBody(res)) };
  };
  const autoLogin = async () => {
    await runAutoLogin((text) => setLoading(true, text));
    setLoading(true);
  };

  setLoading(true);
  hideError();
  $('result').hidden = true;

  try {
    // Missing or expiring key + remembered login → get a fresh one first.
    let loggedIn = false;
    if (auto && userKeyNeedsRefresh(s)) {
      await autoLogin();
      loggedIn = true;
    }
    if (controller !== currentRequest) return;

    let { res, json, text } = await fetchInfo();
    if (controller !== currentRequest) return;   // a newer request took over

    // Rejected key (expired early / pasted manually) → log in once and retry.
    if (res.status === 401 && auto && !loggedIn && getAutoLogin()) {
      await autoLogin();
      if (controller !== currentRequest) return;
      ({ res, json, text } = await fetchInfo());
      if (controller !== currentRequest) return;
    }

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
    if (err instanceof AuthError) {
      showError(t('autoLoginFailed'), err.message);
      openSettings(true);
      return;
    }
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
function setLoading(on, text = t('loading')) {
  $('loadingText').textContent = text;
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
  renderAutoLoginInfo();
  renderEimzoDomainWarn();
  if (eimzoKeys.length) renderEimzoKeys();
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
  $('loginForm').addEventListener('submit', onPasswordLogin);
  $('autoLoginOff').addEventListener('click', disableAutoLogin);
  $('tabPassword').addEventListener('click', () => selectLoginTab('password'));
  $('tabEimzo').addEventListener('click', () => selectLoginTab('eimzo'));
  $('eimzoFind').addEventListener('click', onEimzoFind);
  $('eimzoLogin').addEventListener('click', onEimzoLogin);
  $('eimzoDomainKeySave').addEventListener('click', saveEimzoDomainKey);

  $('jsonToggle').addEventListener('click', toggleJson);
  document.querySelectorAll('.lang__btn').forEach((b) => {
    b.addEventListener('click', () => applyLang(b.dataset.lang));
  });

  applyLang(lang);
  loadSettingsIntoForm();
  renderHistory();

  // First visit without tokens → show settings straight away.
  const s = getSettings();
  if (isDidoxHost(s.baseUrl) && !s.userKey && !getAutoLogin()) openSettings(true);
  if (getAutoLogin()?.method === 'eimzo') selectLoginTab('eimzo');

  $('taxId').focus();
});
