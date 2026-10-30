/* ============================================================
   Minimal E-IMZO client.

   E-IMZO is a desktop app (https://e-imzo.uz) that listens on
   127.0.0.1 and signs data with the user's ЭЦП key. The page talks
   to it over a WebSocket; one message per connection, like the
   official e-imzo.js (github.com/qo0p/e-imzo-doc).

   Pages may send E-IMZO an API key for their domain (public keys
   exist for localhost / 127.0.0.1). The Didox flow works without
   it, so a rejected key only matters if the plugin calls fail too.
   ============================================================ */

'use strict';

class EimzoError extends Error {
  /** code: 'connect' | 'timeout' | 'version' | 'apikey' | 'failed' */
  constructor(code, reason = '') {
    super(reason || code);
    this.code = code;
    this.reason = reason;
  }
}

const Eimzo = (() => {
  // Same endpoints as the official client: wss on https pages, ws on http.
  const SOCKET_URL = (location.protocol === 'https:'
    ? 'wss://127.0.0.1:64443'
    : 'ws://127.0.0.1:64646') + '/service/cryptapi';

  const MIN_VERSION = 336;   // 3.36 — first version with the API used here

  // Signing waits for the user to type the key password in E-IMZO's own window.
  const SHORT_TIMEOUT_MS = 15000;
  const SIGN_TIMEOUT_MS = 5 * 60 * 1000;

  /** Send one JSON message and resolve with the parsed reply. */
  function call(message, timeoutMs = SHORT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let ws;
      let done = false;
      const finish = (err, data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws && ws.close(); } catch { /* ignore */ }
        if (err) reject(err); else resolve(data);
      };
      const timer = setTimeout(() => finish(new EimzoError('timeout')), timeoutMs);

      try {
        ws = new WebSocket(SOCKET_URL);
      } catch {
        finish(new EimzoError('connect'));
        return;
      }
      ws.onopen = () => ws.send(JSON.stringify(message));
      ws.onmessage = (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { finish(new EimzoError('failed', 'bad response')); return; }
        console.info('E-IMZO', message.name, data && data.success, (data && data.reason) || '');
        finish(null, data);
      };
      // Not running / blocked by the browser → error + close before any message.
      ws.onerror = () => finish(new EimzoError('connect'));
      ws.onclose = () => finish(new EimzoError('connect'));
    });
  }

  // Set when E-IMZO turned down our "apikey" call; used to explain later failures.
  let apiKeyRejected = false;

  /** Call a plugin function; throw EimzoError('failed') when success is false. */
  async function plugin(pluginName, name, args, timeoutMs) {
    const msg = { plugin: pluginName, name };
    if (args) msg.arguments = args;
    let data;
    try {
      data = await call(msg, timeoutMs);
    } catch (e) {
      if (apiKeyRejected && e.code === 'connect') throw new EimzoError('apikey');
      throw e;
    }
    if (!data || data.success !== true) {
      const reason = (data && data.reason) || '';
      // E-IMZO may accept "apikey" yet refuse plugins: "API-key для домена … недействителен".
      const keyProblem = apiKeyRejected || /api-?key/i.test(reason);
      throw new EimzoError(keyProblem ? 'apikey' : 'failed', reason);
    }
    return data;
  }

  /**
   * Check that E-IMZO runs and is recent enough; offer it the domain API keys.
   * apiKeys: flat array [domain, key, domain, key, ...].
   */
  async function init(apiKeys) {
    const v = await call({ name: 'version' });
    if (!v || v.success !== true) throw new EimzoError('connect', (v && v.reason) || '');
    const version = parseInt(v.major, 10) * 100 + parseInt(v.minor, 10);
    if (!(version >= MIN_VERSION)) throw new EimzoError('version', `${v.major}.${v.minor}`);

    // Best effort: the Didox flow (api-docs.didox.uz/ru/integrators-eimzo) skips
    // "apikey" and calls the plugins directly, so a rejection is not fatal here.
    // If E-IMZO really refuses this domain, the plugin calls fail and say so.
    try {
      const res = await call({ name: 'apikey', arguments: apiKeys });
      apiKeyRejected = !res || res.success !== true;
    } catch {
      apiKeyRejected = true;
    }
    return `${v.major}.${v.minor}`;
  }

  /**
   * Parse a certificate alias:
   * "cn=fio,name=…,o=…,uid=…,1.2.860.3.16.1.2=PINFL,1.2.860.3.16.1.1=INN,serialnumber=…,validfrom=…,validto=…"
   * Values may contain commas, so split only before "key=" tokens.
   */
  function parseAlias(alias) {
    const out = {};
    const re = /(?:^|,)([a-z][a-z0-9]*|\d+(?:\.\d+)+)=/gi;
    const marks = [];
    let m;
    while ((m = re.exec(alias))) marks.push({ key: m[1].toLowerCase(), start: m.index, valueStart: re.lastIndex });
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].start : alias.length;
      out[mk.key] = alias.slice(mk.valueStart, end).trim();
    });
    return out;
  }

  /** "2024.04.25 23:59:59" → Date */
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s.replace(/\./g, '-').replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }

  /** List .pfx keys found on local disks / flash drives. */
  async function listKeys() {
    const data = await plugin('pfx', 'list_all_certificates');
    return (data.certificates || []).map((c) => {
      const a = parseAlias(c.alias || '');
      const inn = a['1.2.860.3.16.1.1'] || '';    // company ИНН (company keys only)
      const pinfl = a['1.2.860.3.16.1.2'] || '';  // personal ПИНФЛ
      const uid = a.uid || '';                    // personal ИНН
      return {
        disk: c.disk,
        path: c.path,
        name: c.name,
        alias: c.alias,
        serialNumber: a.serialnumber || c.name,
        cn: a.cn || '',
        org: a.o || '',
        title: a.t || '',
        inn,
        pinfl,
        uid,
        // Didox login id: company ИНН if the key belongs to a company, else ПИНФЛ, else personal ИНН.
        loginId: inn || pinfl || uid,
        validFrom: parseDate(a.validfrom),
        validTo: parseDate(a.validto),
      };
    }).filter((k) => /^(\d{9}|\d{14})$/.test(k.loginId));
  }

  /**
   * Sign base64 data with a key from listKeys().
   * E-IMZO opens its own password window during load_key / create_pkcs7.
   * Returns { pkcs7_64, signature_hex }.
   */
  async function sign(key, data64) {
    const loaded = await plugin('pfx', 'load_key', [key.disk, key.path, key.name, key.alias], SIGN_TIMEOUT_MS);
    const signed = await plugin('pkcs7', 'create_pkcs7', [data64, loaded.keyId, 'no'], SIGN_TIMEOUT_MS);
    return { pkcs7_64: signed.pkcs7_64, signature_hex: signed.signature_hex };
  }

  return { init, listKeys, sign, parseAlias };
})();
