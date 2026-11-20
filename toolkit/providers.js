'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Load the providers catalog from providers.json located next to this file.
 * @returns {Array<Object>} Array of provider objects.
 */
function load() {
  const filePath = path.join(__dirname, 'providers.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  return data.providers || [];
}

/**
 * Find a provider by its id.
 * @param {string} id
 * @returns {Object|undefined}
 */
function find(id) {
  return load().find(p => p.id === id);
}

/**
 * Check whether a trimmed key matches the provider's keyFormat regexp.
 * @param {Object} p Provider object.
 * @param {string} key
 * @returns {boolean}
 */
function keyLooksRight(p, key) {
  if (!key) return false;
  const trimmed = key.trim();
  try {
    const re = new RegExp(p.keyFormat);
    return re.test(trimmed);
  } catch (_) {
    return false;
  }
}

/**
 * Test a key against the provider's /models endpoint.
 * @param {Object} p Provider object.
 * @param {string} key API key.
 * @param {Function} fetchImpl Fetch implementation (defaults to global fetch).
 * @param {Object} opts Additional options (e.g., accountId for Cloudflare).
 * @returns {Promise<Object>} Result object.
 */
async function testKey(p, key, fetchImpl = fetch, opts = {}) {
  const trimmed = key.trim();

  // Handle providers that need an account id in the URL.
  if (p.baseUrl.includes('{account_id}')) {
    if (!opts.accountId) {
      return { ok: false, reason: 'needs account id' };
    }
    p = {
      ...p,
      baseUrl: p.baseUrl.replace('{account_id}', opts.accountId)
    };
  }

  const base = p.baseUrl.replace(/\/+$/, '');
  const url = `${base}/models`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + trimmed },
      signal: controller.signal
    });
    const status = resp.status;
    if (status >= 200 && status < 300) {
      return { ok: true };
    }
    if (status === 401 || status === 403) {
      return { ok: false, reason: 'rejected' };
    }
    return { ok: false, reason: `http ${status}` };
  } catch (_) {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reachability check without a key.
 * @param {Object} p Provider object.
 * @param {Function} fetchImpl Fetch implementation (defaults to global fetch).
 * @returns {Promise<Object>} {page, api, alive}
 */
async function reach(p, fetchImpl = fetch) {
  const pageUrl = p.keyUrl;
  const apiUrl = `${p.baseUrl.replace(/\/+$/, '')}/models`;

  const getStatus = async (url) => {
    try {
      const resp = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      return resp.status;
    } catch (_) {
      return 0;
    }
  };

  const [page, api] = await Promise.all([getStatus(pageUrl), getStatus(apiUrl)]);

  const alive =
    page > 0 &&
    page < 500 &&
    [200, 401, 403, 404].includes(api);

  return { page, api, alive };
}

// Command‑line interface for quick checks.
if (require.main === module && process.argv[2] === 'check') {
  (async () => {
    const providers = load();
    for (const p of providers) {
      try {
        const result = await reach(p);
        const aliveStr = result.alive ? 'yes' : 'no';
        console.log(`${p.id} ${p.status} ${result.page} ${result.api} ${aliveStr}`);
      } catch (e) {
        console.error(`Error checking ${p.id}:`, e);
      }
    }
  })();
}

module.exports = {
  load,
  find,
  keyLooksRight,
  testKey,
  reach
};
