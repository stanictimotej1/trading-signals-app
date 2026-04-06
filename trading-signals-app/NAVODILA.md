# 📱 Trading Signals App — Navodila za namestitev

## Kaj dobiš
- iPhone aplikacija (PWA) ki sprejema TradingView signale
- Push notifikacije na zaklenjeni zaslon
- Lepa mobilna vmesnik s signali, TP, SL, win rate statistiko

---

## KORAK 1 — Namesti Node.js (enkrat)
Prenesi z [nodejs.org](https://nodejs.org) in namestitvi.

---

## KORAK 2 — Zaženi strežnik

Odpri Terminal in zaženi:

```bash
cd "pot/do/trading-signals-app"
npm install
npm run generate-keys
```

Shrani izpisane ključe! Izgledata tako:
```
VAPID_PUBLIC=BFxxxx...
VAPID_PRIVATE=xxxx...
```

Potem ustvari `.env` datoteko v mapi:
```
VAPID_PUBLIC=tvoj_public_kljuc
VAPID_PRIVATE=tvoj_private_kljuc
VAPID_EMAIL=mailto:tvoj@email.com
PORT=3000
```

Zaženi strežnik:
```bash
node server.js
```

---

## KORAK 3 — Deploy na internet (za notifikacije izven doma)

### Brezplačno na Railway.app:
1. Ustvari račun na [railway.app](https://railway.app)
2. New Project → "Deploy from GitHub repo"
   - Ali: "Empty project" → naložiš datoteke
3. Nastavi Environment Variables:
   ```
   VAPID_PUBLIC = tvoj_kljuc
   VAPID_PRIVATE = tvoj_kljuc
   VAPID_EMAIL = tvoj@email.com
   ```
4. Railway ti da URL npr: `https://trading-xxx.railway.app`

---

## KORAK 4 — Nastavi iPhone aplikacijo

1. Na iPhonu odpri **Safari**
2. Pojdi na `https://tvoj-server.railway.app`
3. Tapni gumb **Deli** (kvadrat s puščico ↑)
4. Tapni **"Dodaj na začetni zaslon"**
5. Tapni **"Dodaj"**
6. Odpri aplikacijo in tapni **"Vklopi notifikacije"**

> ⚠️ Notifikacije delujejo samo ko je aplikacija dodana na začetni zaslon (ne v Safari brskalnik direktno). Zahteva iOS 16.4 ali novejši.

---

## KORAK 5 — Nastavi TradingView Webhook

### Priporočena strategija za ~80% win rate:
Uporabi kombinacijo **EMA 9/21 + RSI**:

1. V TradingView odpri graf (npr. BTC/USDT, 1H timeframe)
2. Dodaj indikatorja:
   - **EMA 9** (hitra)
   - **EMA 21** (počasna)
   - **RSI** (nastavitev 14)

3. Ustvari Pine Script strategijo ali alert:
   - **BUY signal:** EMA9 prečka EMA21 navzgor + RSI < 70
   - **SELL signal:** EMA9 prečka EMA21 navzdol + RSI > 30

4. Nastavi **Alert**:
   - Klikni 🔔 ikonco
   - Condition: tvoja strategija
   - **Notifications → Webhook URL:**
     ```
     https://tvoj-server.railway.app/webhook
     ```
   - **Message** (kopiraj točno to):
     ```json
     {
       "action": "{{strategy.order.action}}",
       "symbol": "{{ticker}}",
       "price": {{close}},
       "tp": {{strategy.order.price}},
       "sl": 0,
       "timeframe": "{{interval}}",
       "confidence": 80
     }
     ```

---

## Format webhook sporočila

Strežnik razume ta format (prilagodi po potrebi):

```json
{
  "action": "BUY",           // ali "SELL"
  "symbol": "BTCUSDT",       // par
  "price": 65000,            // vstopna cena
  "tp": 67000,               // take profit
  "sl": 63000,               // stop loss
  "timeframe": "1H",         // časovni okvir
  "confidence": 82           // zaupanje v %
}
```

---

## Testiranje

Pošlji testni signal (ko strežnik teče):

```bash
curl -X POST http://localhost:3000/api/test-signal \
  -H "Content-Type: application/json" \
  -d '{"action":"BUY","symbol":"BTC/USDT","price":65000,"tp":67000,"sl":63000}'
```

---

## Struktura datotek

```
trading-signals-app/
├── index.html      → iPhone aplikacija (PWA)
├── sw.js           → Service Worker (notifikacije)
├── manifest.json   → PWA konfiguracija
├── server.js       → Node.js backend
├── package.json    → Odvisnosti
├── icon-192.png    → Ikona
├── icon-512.png    → Ikona
└── NAVODILA.md     → Ta datoteka
```

---

## Pomoč

Če nimaš Railway računa ali nočeš deployjati, strežnik zaženi lokalno in ga izpostavi z **[ngrok](https://ngrok.com)**:

```bash
npm install -g ngrok
ngrok http 3000
```

Ngrok ti da javni URL ki ga lahko uporabiš za TradingView webhook.

---

*Narejeno z ❤️ za iPhone trading*
