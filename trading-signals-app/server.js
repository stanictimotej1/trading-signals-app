/**
 * Trading Signals - Node.js Backend
 * ===================================
 * Sprejema TradingView webhooks in pošilja
 * push notifikacije na iPhone (PWA).
 *
 * Namestitev:
 *   npm install
 *   node server.js
 *
 * Deploy na Railway.app (brezplačno):
 *   1. Ustvari račun na railway.app
 *   2. New Project → Deploy from GitHub
 *   3. Nastavi environment variable PORT=3000
 */

const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── VAPID KLJUČI (za push notifikacije) ─────────────────
// ENKRAT generiraj in shrani v .env:
//   node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k))"
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'ZAMENJAJ_S_TVOJIM_PUBLIC_KLUCEM';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'ZAMENJAJ_S_TVOJIM_PRIVATE_KLUCEM';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:tvoj@email.com';
// ──────────────────────────────────────────────────────────

// Nastavi web-push
if (VAPID_PUBLIC !== 'ZAMENJAJ_S_TVOJIM_PUBLIC_KLUCEM') {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── SHRAMBA ─────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'db.json');
let db = { signals: [], subscriptions: [] };

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) { console.log('DB error:', e.message); }
}

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch(e) { console.log('Save error:', e.message); }
}

loadDB();
// ──────────────────────────────────────────────────────────

// ─── API ENDPOINTS ────────────────────────────────────────

// Pridobi zadnje signale (polling)
app.get('/api/signals', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const newSignals = db.signals.filter(s => s.id > since);
  res.json({ signals: newSignals, total: db.signals.length });
});

// Shrani push subscription (iz brskalnika)
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Manjka subscription' });
  }

  // Preveri ali že obstaja
  const exists = db.subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    db.subscriptions.push(subscription);
    saveDB();
    console.log(`✅ Nova subscription (skupaj: ${db.subscriptions.length})`);
  }

  res.json({ success: true, count: db.subscriptions.length });
});

// TradingView Webhook - GLAVNA TOČKA
// Format sporočila v TradingView (prilagodi po potrebi):
// {
//   "action": "{{strategy.order.action}}",
//   "symbol": "{{ticker}}",
//   "price": {{close}},
//   "tp": {{strategy.order.price}},
//   "sl": 0,
//   "timeframe": "{{interval}}",
//   "confidence": 80
// }
app.post('/webhook', async (req, res) => {
  console.log('📨 Webhook prejet:', JSON.stringify(req.body));

  let signal;

  // Podpri različne formate
  if (typeof req.body === 'string') {
    try { signal = JSON.parse(req.body); }
    catch { signal = parseTextSignal(req.body); }
  } else {
    signal = req.body;
  }

  // Normalizacija
  const normalizedSignal = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    action: (signal.action || signal.side || signal.type || 'BUY').toUpperCase(),
    symbol: signal.symbol || signal.ticker || signal.pair || 'BTC/USDT',
    price: parseFloat(signal.price || signal.close || signal.entry || 0),
    tp: parseFloat(signal.tp || signal.takeProfit || signal.take_profit || 0),
    sl: parseFloat(signal.sl || signal.stopLoss || signal.stop_loss || 0),
    timeframe: signal.timeframe || signal.interval || '1H',
    confidence: parseInt(signal.confidence || 78),
    strategy: signal.strategy || 'TradingView'
  };

  // Shrani
  db.signals.unshift(normalizedSignal);
  if (db.signals.length > 500) db.signals = db.signals.slice(0, 500);
  saveDB();

  // Pošlji push notifikacije vsem naročnikom
  const results = await sendPushToAll(normalizedSignal);
  console.log(`✅ Signal shranjen, poslano: ${results.sent}/${results.total} notifikacij`);

  res.json({ success: true, signal: normalizedSignal, pushed: results });
});

// Test endpoint
app.post('/api/test-signal', async (req, res) => {
  const testSignal = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    action: req.body.action || 'BUY',
    symbol: req.body.symbol || 'BTC/USDT',
    price: req.body.price || 65000,
    tp: req.body.tp || 67000,
    sl: req.body.sl || 63000,
    timeframe: '1H',
    confidence: 82,
    strategy: 'Test'
  };

  db.signals.unshift(testSignal);
  saveDB();

  const results = await sendPushToAll(testSignal);
  res.json({ success: true, signal: testSignal, pushed: results });
});

// Status strežnika
app.get('/api/status', (req, res) => {
  res.json({
    status: 'OK',
    signals: db.signals.length,
    subscribers: db.subscriptions.length,
    uptime: process.uptime(),
    vapidConfigured: VAPID_PUBLIC !== 'ZAMENJAJ_S_TVOJIM_PUBLIC_KLUCEM'
  });
});

// VAPID public key (za frontend)
app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// ─── PUSH NOTIFIKACIJE ────────────────────────────────────

async function sendPushToAll(signal) {
  if (db.subscriptions.length === 0) {
    return { sent: 0, total: 0, errors: [] };
  }

  const emoji = signal.action === 'BUY' ? '🟢' : '🔴';
  const payload = JSON.stringify({
    title: `${emoji} ${signal.action} ${signal.symbol}`,
    body: `Cena: $${signal.price.toLocaleString()} | TP: $${signal.tp.toLocaleString()} | SL: $${signal.sl.toLocaleString()}`,
    ...signal
  });

  let sent = 0;
  const errors = [];
  const deadSubscriptions = [];

  for (const subscription of db.subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch(err) {
      console.log('Push error:', err.statusCode, subscription.endpoint.slice(0, 50));
      errors.push(err.message);

      // Odstrani neveljavne subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadSubscriptions.push(subscription.endpoint);
      }
    }
  }

  // Počisti neveljavne
  if (deadSubscriptions.length > 0) {
    db.subscriptions = db.subscriptions.filter(
      s => !deadSubscriptions.includes(s.endpoint)
    );
    saveDB();
    console.log(`🗑️ Odstranjenih ${deadSubscriptions.length} neveljavnih subscriptions`);
  }

  return { sent, total: db.subscriptions.length, errors };
}

function parseTextSignal(text) {
  // Razčleni besedilni signal npr. "BUY BTC 65000 TP:67000 SL:63000"
  const upper = text.toUpperCase();
  return {
    action: upper.includes('BUY') ? 'BUY' : 'SELL',
    symbol: upper.match(/BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOT/)?.[0] || 'CRYPTO',
    price: parseFloat(text.match(/\d+\.?\d*/)?.[0] || 0),
    tp: parseFloat(text.match(/TP[:\s]*(\d+\.?\d*)/i)?.[1] || 0),
    sl: parseFloat(text.match(/SL[:\s]*(\d+\.?\d*)/i)?.[1] || 0)
  };
}

// ─── START ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   Trading Signals Server             ║
║   Port: ${PORT}                         ║
║   Status: ✅ AKTIVNO                ║
╚══════════════════════════════════════╝

📡 Webhook URL: http://localhost:${PORT}/webhook
📊 API Status:  http://localhost:${PORT}/api/status
🧪 Test Signal: POST http://localhost:${PORT}/api/test-signal

NASLEDNJI KORAKI:
1. Generiraj VAPID ključe:
   node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"
2. Nastavi env spremenljivke VAPID_PUBLIC in VAPID_PRIVATE
3. Odpri aplikacijo v Safari in dodaj na začetni zaslon
4. V TradingView nastavi webhook na: http://tvoj-server/webhook
  `);
});
