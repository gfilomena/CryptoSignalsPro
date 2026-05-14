# 🚀 ONE-FILE DEPLOY - Zero Configuration

> **Nota (2026):** l’app principale è la SPA **React + Vite** in root (`npm run build` → `dist/`). Il deploy consigliato su Vercel è il framework Vite alla root del repo. Il vecchio monolite HTML è in [`legacy/index.html`](legacy/index.html) (deploy “un solo file” manuale come sotto).

## ✨ **Deploy in 2 Minutes on FREE Hosting**

Just ONE file: **`btc-alerts-standalone.html`** (oppure usa `legacy/index.html` se rinomini per drag-and-drop)

No backend, no configuration, no VAPID keys needed!

---

## 🎯 **Option 1: Netlify (EASIEST)** ⭐

### Drag & Drop Deploy:

1. Go to [netlify.com](https://netlify.com)
2. **Drag & drop** `btc-alerts-standalone.html` into the browser
3. Done! ✅

**Your URL:** `https://random-name.netlify.app`

### Or via CLI:
```bash
npm install -g netlify-cli
netlify deploy --prod

# Drop file: btc-alerts-standalone.html
```

**Time:** 30 seconds! 🎉

---

## 🎯 **Option 2: Vercel**

```bash
# Install Vercel CLI
npm i -g vercel

# Create folder
mkdir btc-alerts
mv btc-alerts-standalone.html btc-alerts/index.html
cd btc-alerts

# Deploy
vercel --prod
```

**Your URL:** `https://btc-alerts.vercel.app`

**Time:** 1 minute

---

## 🎯 **Option 3: GitHub Pages**

```bash
# 1. Create repo on GitHub
# 2. Upload btc-alerts-standalone.html as index.html

git init
git add btc-alerts-standalone.html
git commit -m "Deploy BTC Alerts"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/btc-alerts.git
git push -u origin main

# 3. Enable GitHub Pages
# Settings → Pages → Source: main branch → Save
```

**Your URL:** `https://YOUR-USERNAME.github.io/btc-alerts/btc-alerts-standalone.html`

**Time:** 2 minutes

---

## 🎯 **Option 4: Cloudflare Pages**

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Create new project
3. Upload `btc-alerts-standalone.html`
4. Done! ✅

**Your URL:** `https://btc-alerts.pages.dev`

---

## 🎯 **Option 5: Surge.sh**

```bash
# Install
npm install -g surge

# Deploy
surge btc-alerts-standalone.html

# Choose subdomain: btc-alerts.surge.sh
```

**Your URL:** `https://btc-alerts.surge.sh`

**Time:** 30 seconds

---

## 🎯 **Option 6: Tiiny.host**

1. Go to [tiiny.host](https://tiiny.host)
2. Upload `btc-alerts-standalone.html`
3. Done! Free for 7 days

**Your URL:** `https://xyz123.tiiny.site`

---

## ✅ **What Works:**

- ✅ Real-time BTC data from Binance
- ✅ All technical indicators (RSI, MACD, EMA, Support/Resistance)
- ✅ Auto-update every 30 seconds
- ✅ Buy/Sell signals
- ✅ Mobile responsive
- ✅ Works on ANY device

## ❌ **What Doesn't Work:**

- ❌ Push notifications (needs backend with VAPID keys)
- ❌ PWA install (needs manifest + service worker)

---

## 🎨 **Rename File (Optional)**

For cleaner URLs, rename to `index.html`:

```bash
mv btc-alerts-standalone.html index.html
```

Then deploy. URL will be cleaner:
- Before: `https://site.com/btc-alerts-standalone.html`
- After: `https://site.com/` or `https://site.com/index.html`

---

## 🔧 **Customize (Optional)**

Open `btc-alerts-standalone.html` and edit:

### Change update interval:
Line ~780:
```javascript
setInterval(update, 30000); // 30 seconds

// Change to:
setInterval(update, 60000); // 1 minute
setInterval(update, 10000); // 10 seconds
```

### Change RSI thresholds:
Line ~490:
```javascript
if (data.rsi < 35) { // Buy threshold
if (data.rsi > 65) { // Sell threshold

// Change to be more conservative:
if (data.rsi < 30) { // Buy at deeper oversold
if (data.rsi > 70) { // Sell at higher overbought
```

---

## 🆓 **Cost Comparison:**

| Platform | Cost | SSL | Custom Domain |
|----------|------|-----|---------------|
| Netlify | FREE | ✅ | ✅ |
| Vercel | FREE | ✅ | ✅ |
| GitHub Pages | FREE | ✅ | ✅ |
| Cloudflare Pages | FREE | ✅ | ✅ |
| Surge | FREE | ✅ | ✅ (paid) |
| Tiiny.host | FREE 7 days | ✅ | ❌ |

**All are FREE forever for this use case!**

---

## 📱 **Mobile Access:**

After deploy, just open URL on your phone!

Add to home screen:
- **iOS:** Share → Add to Home Screen
- **Android:** Menu → Add to Home screen

Works like a native app! 📱

---

## 🎉 **FASTEST Deploy (30 seconds):**

```bash
# 1. Install Netlify CLI
npm i -g netlify-cli

# 2. Deploy
netlify deploy --prod

# 3. Drag btc-alerts-standalone.html when prompted

# DONE! 🎉
```

**That's it!** No configuration, no backend, no VAPID keys!

---

## 🔗 **Test It:**

Open the file locally first:
```bash
# Mac:
open btc-alerts-standalone.html

# Linux:
xdg-open btc-alerts-standalone.html

# Windows:
start btc-alerts-standalone.html
```

Should work immediately with live Binance data! ✅

---

## 💡 **Pro Tip:**

Want push notifications? Use this standalone version + set up browser alerts manually:

1. Open app in browser
2. Bookmark it
3. Check it regularly

Or use the full backend version from the main project if you need real push notifications.

---

## 🆘 **Troubleshooting:**

### "Failed to fetch Binance data"
- Check internet connection
- Binance API might be rate-limited (wait 1 minute)
- Try opening in incognito mode

### "No data showing"
- Open browser console (F12)
- Check for CORS errors
- All free hosts support CORS, so this should work

### "Indicators not calculating"
- Wait 30 seconds for first update
- Refresh page
- Check that you have 50+ data points from Binance

---

## ✅ **That's It!**

One file, zero configuration, works everywhere.

**Deploy now and start tracking BTC signals!** 🚀
