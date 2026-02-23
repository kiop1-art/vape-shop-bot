# 🚀 Деплой бота

## ⚡ Быстрый старт (локально)

```bash
npm install
npm start
```

**Важно:** Запускайте только ОДИН экземпляр бота с polling. Если бот уже работает на сервере — не запускайте локально!

---

## 📦 Vercel (рекомендуется)

### Шаг 1: Подготовь проект

1. Убедись, что `.env` содержит:
   ```
   BOT_TOKEN=your_bot_token
   ADMIN_IDS=your_admin_id
   VERCEL_URL=your-app.vercel.app
   WEB_APP_URL=https://your-app.vercel.app
   ```

2. Установи Vercel CLI:
   ```bash
   npm i -g vercel
   ```

### Шаг 2: Задеплой на Vercel

```bash
vercel login
vercel --prod
```

### Шаг 3: Настрой webhook

После деплоя выполни:

```bash
node set-webhook.js
```

Это установит webhook для бота на Vercel.

### Шаг 4: Настрой Mini App

1. Открой @BotFather
2. Bot Settings → Menu Button → Configure Menu Button
3. Отправь URL: `https://your-app.vercel.app`
4. Название: `🛒 Открыть магазин`

---

## 🖥️ Render (постоянно, бесплатно)

### Шаг 1: Зарегистрируйся на Render
1. Открой https://render.com
2. Нажми **Sign Up** → войди через GitHub

### Шаг 2: Создай репозиторий на GitHub
1. Открой https://github.com/new
2. Название: `vape-shop-bot`
3. Сделай репозиторий **Public**
4. Загрузи файлы проекта (через Git или ZIP)

### Шаг 3: Создай Web Service на Render
1. В панели Render нажми **New +** → **Web Service**
2. Подключи GitHub репозиторий с ботом
3. Настройки:
   - **Name**: `vape-shop-bot`
   - **Region**: Frankfurt (Europe)
   - **Branch**: main
   - **Root Directory**: (оставь пустым)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node bot/index.js`
   - **Instance Type**: Free

4. **Environment Variables** (добавь переменные):
   ```
   BOT_TOKEN=your_bot_token
   ADMIN_IDS=your_admin_id
   PORT=3001
   WEB_APP_URL=https://vape-shop-bot.onrender.com
   ```

5. Нажми **Create Web Service**

### Шаг 4: Подожди деплой
- Render создаст сервис (~3-5 минут)
- Скопируй URL (типа `https://vape-shop-bot.onrender.com`)

### Шаг 5: Обнови WEB_APP_URL
1. В Render замени `WEB_APP_URL` на твой URL
2. Нажми **Manual Deploy** для перезапуска

### Шаг 6: Настрой бота
1. Открой @BotFather
2. Bot Settings → Menu Button → Configure Menu Button
3. Отправь URL: `https://vape-shop-bot.onrender.com`
4. Название: `🛒 Открыть магазин`

---

## 🚂 Railway (ещё проще)

1. Открой https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. Выбери репозиторий
4. Добавь переменные окружения в Settings
5. Railway сам всё настроит!

URL будет: `https://your-project.railway.app`

---

## ⚠️ Важно!

- **НЕ запускайте несколько экземпляров бота одновременно** — будет ошибка 409 Conflict
- Для **Vercel** используется **webhook** (без polling)
- Для **Render/Railway** используется **polling** (бот работает постоянно)
