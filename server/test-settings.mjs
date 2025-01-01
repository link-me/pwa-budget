import assert from 'node:assert/strict';
import http from 'http';
import https from 'https';

const API = process.env.API_URL || 'http://127.0.0.1:8051';

function requestJson(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      const payload = body != null ? JSON.stringify(body) : null;
      const opts = {
        method,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        headers: {
          ...(headers || {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };
      const req = client.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json;
          try { json = JSON.parse(data || '{}'); } catch { json = {}; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`${method} ${url} failed: ${res.statusCode} ${data}`));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function postJson(url, body, token) {
  return requestJson('POST', url, body, {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

function putJson(url, body, token) {
  return requestJson('PUT', url, body, {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

function getJson(url, token) {
  return requestJson('GET', url, null, {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

async function ensureUser(email, password) {
  // Try register, ignore 409
  try {
    await postJson(`${API}/api/register`, { email, password, name: 'Ticker Tester' });
  } catch (e) {
    // If email exists, treat as ok
    if (!String(e.message).includes('409')) throw e;
  }
}

async function login(email, password) {
  const json = await postJson(`${API}/api/login`, { email, password });
  assert.ok(json.token, 'login should return token');
  return json.token;
}

async function run() {
  const email = 'ticker.test@example.invalid';
  const password = 'pwa-budget-test-123';

  await ensureUser(email, password);
  const token = await login(email, password);

  // 1) Read settings initially (may be empty)
  const initial = await getJson(`${API}/api/settings`, token);
  assert.equal(typeof initial, 'object');

  // 2) Put ticker settings
  const payload = {
    ticker: {
      mode: 'auto',
      intervalSec: 15,
      autoCoins: ['bitcoin', 'ethereum'],
      autoVsCurrency: 'usd',
      manualItems: [
        { label: 'BTC', value: 'bitcoin', visible: true },
        { label: 'ETH', value: 'ethereum', visible: false },
      ],
    },
  };

  const saved = await putJson(`${API}/api/settings`, payload, token);
  assert.deepEqual(saved, payload);

  // 3) Read back and check persistence
  const after = await getJson(`${API}/api/settings`, token);
  assert.deepEqual(after, payload);

  // 4) Update visibility and interval, ensure overwrite works
  const payload2 = {
    ticker: {
      ...payload.ticker,
      intervalSec: 30,
      manualItems: payload.ticker.manualItems.map(it => it.label === 'ETH' ? { ...it, visible: true } : it),
    },
  };
  const saved2 = await putJson(`${API}/api/settings`, payload2, token);
  assert.deepEqual(saved2, payload2);
  const after2 = await getJson(`${API}/api/settings`, token);
  assert.deepEqual(after2, payload2);

  console.log('OK: /api/settings persisted and updated as expected');
}

run().catch(err => {
  console.error('TEST FAILED:', err && err.stack || err);
  process.exit(1);
});