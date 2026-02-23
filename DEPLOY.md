# 🚀 Деплой на Render (бесплатно, постоянно)

## Шаг 1: Зарегистрируйся на Render
1. Открой https://render.com
2. Нажми **Sign Up** → войди через GitHub

## Шаг 2: Создай репозиторий на GitHub
1. Открой https://github.com/new
2. Название: `vape-shop-bot`
3. Сделай репозиторий **Public**
4. Загрузи файлы проекта (через Git или ZIP)

## Шаг 3: Создай Web Service на Render
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
   BOT_TOKEN=8653233012:AAFMjbyjRQjkOV9wCgabjVPkdOshEtSykog
   ADMIN_IDS=6786143825
   PORT=3001
   WEB_APP_URL=https://vape-shop-bot.onrender.com
   ```

5. Нажми **Create Web Service**

## Шаг 4: Подожди деплой
- Render создаст сервис (~3-5 минут)
- Скопируй URL (типа `https://vape-shop-bot.onrender.com`)

## Шаг 5: Обнови WEB_APP_URL
1. В Render замени `WEB_APP_URL` на твой URL
2. Нажми **Manual Deploy** для перезапуска

## Шаг 6: Настрой бота
1. Открой @BotFather
2. Bot Settings → Menu Button → Configure Menu Button
3. Отправь URL: `https://vape-shop-bot.onrender.com`
4. Название: `🛒 Открыть магазин`

## Готово! 🎉

Бот работает постоянно с HTTPS!

---

## Альтернатива: Railway (ещё проще)

1. Открой https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. Выбери репозиторий
4. Добавь переменные окружения в Settings
5. Railway сам всё настроит!

URL будет: `https://your-project.railway.app`
