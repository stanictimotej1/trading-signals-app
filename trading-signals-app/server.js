/**
 * Trading Signals — Binance WebSocket + EMA/RSI Strategija
 * ==========================================================
 * Avtomatsko generira BUY/SELL signale iz Binance tržnih podatkov.
 * Brez TradingView, brez plačila — samo Binance javni API.
 *
 * Strategija: EMA 9/21 crossover + RSI 14
 *   BUY:  EMA9 prečka EMA21 navzgor  +  RSI < 70
 *   SELL: EMA9 prečka EMA21 navzdol  +  RSI > 30
 */

const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── KONFIGURACIJA ────────────────────────────────────────
const SYMBOL    = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
const INTERVAL  = process.env.INTERVAL || '1h';    // 1m, 5m, 15m, 1h, 4h, 1d
const EMA_FAST  = parseInt(process.env.EMA_FAST || '9');
const EMA_SLOW  = parseInt(process.env.EMA_SLOW || '21');
const RSI_PERIOD = parseInt(process.env.RSI_PERIOD || '14');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'ZAMENJAJ';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'ZAMENJAJ';
const VAPID_EMAIL   = process.env.VAPID_EMAIL   || 'mailto:timotejstanic5@gmail.com';
// ──────────────────────────────────────────────────────────

if (VAPID_PUBLIC !== 'ZAMENJAJ') {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── BAZA ─────────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'db.json');
let db = { signals: [], subscriptions: [] };

function loadDB() {
  try { if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch(e) {}
}
function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch(e) {}
}
loadDB();

// ─── INDIKATORJI ──────────────────────────────────────────
let candles = [];          // zgodovina svečnikov
let prevEmaFast = null;
let prevEmaSlow = null;
let lastSignalType = null; // prepreči dvojne signale

function calcEMA(price, prevEma, period) {
  const k = 2 / (period + 1);
  if (prevEma === null) return price;
  return price * k + prevEma * (1 - k);
}

function calcRSI(closes, period) {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(-period - 1).map((c, i, a) => i === 0 ? 0 : c - a[i-1]).slice(1);
  const gains = changes.filter(c => c > 0);
  const losses = changes.filter(c => c < 0).map(Math.abs);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcTP(price, action, atr) {
  const mult = 2.0;
  return action === 'BUY'
    ? Math.round((price + atr * mult) * 100) / 100
    : Math.round((price - atr * mult) * 100) / 100;
}

function calcSL(price, action, atr) {
  const mult = 1.2;
  return action === 'BUY'
    ? Math.round((price - atr * mult) * 100) / 100
    : Math.round((price + atr * mult) * 100) / 100;
}

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return candles[candles.length - 1]?.close * 0.01 || 100;
  const trs = candles.slice(-period - 1).map((c, i, a) => {
    if (i === 0) return c.high - c.low;
    return Math.max(c.high - c.low, Math.abs(c.high - a[i-1].close), Math.abs(c.low - a[i-1].close));
  });
  return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

function processCandle(candle) {
  candles.push(candle);
  if (candles.length > 100) candles.shift();

  const closes = candles.map(c => c.close);
  const price = candle.close;

  const emaFast = calcEMA(price, prevEmaFast, EMA_FAST);
  const emaSlow = calcEMA(price, prevEmaSlow, EMA_SLOW);
  const rsi = calcRSI(closes, RSI_PERIOD);

  let signal = null;

  // BUY: EMA9 prečka EMA21 navzgor + RSI ni pregret
  if (prevEmaFast !== null && prevEmaSlow !== null) {
    const crossUp   = prevEmaFast <= prevEmaSlow && emaFast > emaSlow;
    const crossDown = prevEmaFast >= prevEmaSlow && emaFast < emaSlow;

    if (crossUp && rsi < 70 && lastSignalType !== 'BUY') {
      signal = 'BUY';
      lastSignalType = 'BUY';
    } else if (crossDown && rsi > 30 && lastSignalType !== 'SELL') {
      signal = 'SELL';
      lastSignalType = 'SELL';
    }
  }

  prevEmaFast = emaFast;
  prevEmaSlow = emaSlow;

  if (signal) {
    const atr = calcATR(candles);
    const confidence = Math.min(95, Math.max(65,
      signal === 'BUY' ? 100 - rsi : rsi
    ));

    const newSignal = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action: signal,
      symbol: SYMBOL.replace('USDT', '/USDT'),
      price: price,
      tp: calcTP(price, signal, atr),
      sl: calcSL(price, signal, atr),
      timeframe: INTERVAL,
      confidence: confidence,
      rsi: rsi,
      emaFast: Math.round(emaFast * 100) / 100,
      emaSlow: Math.round(emaSlow * 100) / 100,
      strategy: `EMA${EMA_FAST}/${EMA_SLOW} + RSI${RSI_PERIOD}`
    };

    db.signals.unshift(newSignal);
    if (db.signals.length > 500) db.signals = db.signals.slice(0, 500);
    saveDB();

    console.log(`🚨 SIGNAL: ${signal} ${SYMBOL} @ $${price} | RSI: ${rsi} | Confidence: ${confidence}%`);
    sendPushToAll(newSignal);
  }

  // Log vsakih 10 svečnikov
  if (candles.length % 10 === 0) {
    console.log(`📊 ${SYMBOL} | Cena: $${price} | EMA${EMA_FAST}: ${Math.round(emaFast)} | EMA${EMA_SLOW}: ${Math.round(emaSlow)} | RSI: ${rsi}`);
  }
}

// ─── BINANCE WEBSOCKET ────────────────────────────────────
function connectBinance() {
  const wsUrl = `wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@kline_${INTERVAL}`;
  console.log(`🔌 Povezujem na Binance: ${wsUrl}`);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`✅ Povezan na Binance WebSocket (${SYMBOL} ${INTERVAL})`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const k = msg.k;

      if (!k) return;

      const candle = {
        time:   k.t,
        open:   parseFloat(k.o),
        high:   parseFloat(k.h),
        low:    parseFloat(k.l),
        close:  parseFloat(k.c),
        volume: parseFloat(k.v),
        closed: k.x  // true = zaprta svečka
      };

      // Procesiraj samo zaprte svečnike (za signale)
      if (candle.closed) {
        processCandle(candle);
      }

      // Posodobi zadnjo ceno v realnem času
      currentPrice = candle.close;

    } catch(e) {
      console.log('WS parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('⚠️ Binance WS zaprt, reconnect čez 5s...');
    setTimeout(connectBinance, 5000);
  });

  ws.on('error', (err) => {
    console.log('WS napaka:', err.message);
  });
}

let currentPrice = 0;
connectBinance();

// ─── API ENDPOINTS ────────────────────────────────────────

app.get('/api/signals', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const newSignals = db.signals.filter(s => s.id > since);
  res.json({ signals: newSignals, total: db.signals.length, currentPrice });
});

app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Manjka subscription' });

  const exists = db.subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    db.subscriptions.push(subscription);
    saveDB();
    console.log(`✅ Nova push subscription (skupaj: ${db.subscriptions.length})`);
  }
  res.json({ success: true });
});

app.get('/api/status', (req, res) => {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, RSI_PERIOD);
  res.json({
    status: 'OK',
    symbol: SYMBOL,
    interval: INTERVAL,
    currentPrice,
    candles: candles.length,
    rsi,
    emaFast: prevEmaFast ? Math.round(prevEmaFast * 100) / 100 : null,
    emaSlow: prevEmaSlow ? Math.round(prevEmaSlow * 100) / 100 : null,
    signals: db.signals.length,
    subscribers: db.subscriptions.length,
    strategy: `EMA${EMA_FAST}/${EMA_SLOW} + RSI${RSI_PERIOD}`
  });
});

app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// ─── PUSH NOTIFIKACIJE ────────────────────────────────────
async function sendPushToAll(signal) {
  if (!db.subscriptions.length) return { sent: 0 };

  const emoji = signal.action === 'BUY' ? '🟢' : '🔴';
  const payload = JSON.stringify({
    title: `${emoji} ${signal.action} ${signal.symbol}`,
    body: `$${signal.price.toLocaleString()} | TP: $${signal.tp.toLocaleString()} | SL: $${signal.sl.toLocaleString()} | RSI: ${signal.rsi}`,
    ...signal
  });

  let sent = 0;
  const dead = [];

  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch(err) {
      if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
    }
  }

  if (dead.length) {
    db.subscriptions = db.subscriptions.filter(s => !dead.includes(s.endpoint));
    saveDB();
  }

  return { sent, total: db.subscriptions.length };
}

// ─── START ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Trading Signals — Binance Edition      ║
║   Port:     ${PORT}                           ║
║   Symbol:   ${SYMBOL.padEnd(10)}              ║
║   Interval: ${INTERVAL.padEnd(10)}              ║
║   Strategy: EMA${EMA_FAST}/${EMA_SLOW} + RSI${RSI_PERIOD}            ║
╚══════════════════════════════════════════╝
  `);
});
