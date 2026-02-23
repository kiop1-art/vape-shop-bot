require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const PORT = process.env.PORT || 8080;
const CHANNEL_ID = process.env.CHANNEL_ID || '@vapeshop_channel';

let bot;
let app;
let WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3001';

// Хранилище состояний
const adminState = {};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function start() {
  await db.initDatabase();
  console.log('✅ БД инициализирована');
  
  bot = new TelegramBot(token, { polling: true });
  app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../webapp')));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  function registerUser(userId, username, firstName, lastName) {
    try {
      const existing = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(userId);
      if (existing) {
        db.prepare('UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?')
          .run(username || null, firstName || null, lastName || null, userId);
      } else {
        db.prepare('INSERT INTO users (telegram_id, username, first_name, last_name, is_subscribed) VALUES (?, ?, ?, ?, 1)')
          .run(userId, username || null, firstName || null, lastName || null);
      }
    } catch (e) { console.error(e); }
  }

  async function checkSubscription(userId) {
    try {
      const member = await bot.getChatMember(CHANNEL_ID.replace('@', ''), userId);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (e) { return false; }
  }

  function isAdmin(userId) { return adminIds.includes(parseInt(userId)); }
  function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }

  // Главная клавиатура
  const mainKbd = {
    inline_keyboard: [[
      { text: '🛒 Открыть магазин', web_app: { url: WEB_APP_URL } }
    ]]
  };

  // Админ клавиатура
  const adminKbd = {
    inline_keyboard: [
      [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
      [{ text: '📦 Заказы', callback_data: 'admin_orders' }],
      [{ text: '➕ Добавить товар', callback_data: 'admin_add_product' }],
      [{ text: '📰 Новости', callback_data: 'admin_news' }],
      [{ text: '🎁 Промокоды', callback_data: 'admin_promocodes' }],
      [{ text: '👥 Пользователи', callback_data: 'admin_users' }]
    ]
  };

  // Меню товаров
  const productsMenuKbd = {
    inline_keyboard: [
      [{ text: '➕ Добавить товар', callback_data: 'add_product' }],
      [{ text: '📦 Список товаров', callback_data: 'list_products' }],
      [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
    ]
  };

  // Меню новостей
  const newsMenuKbd = {
    inline_keyboard: [
      [{ text: '➕ Добавить новость', callback_data: 'add_news' }],
      [{ text: '📰 Список новостей', callback_data: 'list_news' }],
      [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
    ]
  };

  // Меню промокодов
  const promocodeMenuKbd = {
    inline_keyboard: [
      [{ text: '➕ Создать промокод', callback_data: 'add_promocode' }],
      [{ text: '🎁 Список промокодов', callback_data: 'list_promocodes' }],
      [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
    ]
  };

  async function sendStartMessage(chatId, firstName) {
    registerUser(chatId, null, firstName, null);
    
    const isSub = await checkSubscription(chatId);
    if (!isSub) {
      bot.sendMessage(chatId, `⚠️ <b>Для использования бота подпишитесь на канал!</b>\n\n📢 ${escapeHtml(CHANNEL_ID)}\n\nПосле подписки нажмите кнопку:`, {
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Я подписался', callback_data: 'check_sub' }]]
        },
        parse_mode: 'HTML'
      });
      return;
    }
    
    bot.sendMessage(chatId, `👋 Привет, ${escapeHtml(firstName)}!\n\n🛍️ <b>VapeShop</b> — твой магазин`, {
      reply_markup: isAdmin(chatId) ? adminKbd : mainKbd,
      parse_mode: 'HTML'
    });
  }

  bot.onText(/\/start/, (msg) => {
    sendStartMessage(msg.chat.id, msg.from.first_name);
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const msgId = query.message.message_id;

    // Проверка подписки
    if (data === 'check_sub') {
      const isSub = await checkSubscription(chatId);
      if (isSub) {
        bot.deleteMessage(chatId, msgId);
        sendStartMessage(chatId, query.from.first_name);
      } else {
        bot.answerCallbackQuery(query.id, { text: '❌ Подпишитесь на канал!', show_alert: true });
      }
      return;
    }

    // Только для админов
    if (!isAdmin(chatId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещён', show_alert: true });
      return;
    }

    // === АДМИН МЕНЮ ===
    if (data === 'admin_menu') {
      bot.editMessageText('🔑 <b>Админ-панель</b>\n\nВыберите раздел:', {
        chat_id: chatId,
        message_id: msgId,
        reply_markup: adminKbd,
        parse_mode: 'HTML'
      });
      return;
    }

    // Статистика
    if (data === 'admin_stats') {
      const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      const products = db.prepare('SELECT COUNT(*) as c FROM products WHERE is_active = 1').get().c;
      const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
      const revenue = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as t FROM orders WHERE status != \'cancelled\'').get().t;
      
      bot.sendMessage(chatId, `📊 <b>Статистика</b>\n\n👥 ${users}\n🛍️ ${products}\n📦 ${orders}\n💰 ${formatPrice(revenue)}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] },
        parse_mode: 'HTML'
      });
      return;
    }

    // Заказы
    if (data === 'admin_orders') {
      const orders = db.prepare('SELECT o.*, u.first_name, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 10').all();
      if (orders.length === 0) {
        bot.sendMessage(chatId, '📭 Заказов нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      orders.forEach(o => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
        const itemsText = items.map(i => `• ${escapeHtml(i.product_name)} x${i.quantity}`).join('\n');
        bot.sendMessage(chatId, `📦 #${o.order_uuid.substring(0, 8)}\n👤 ${escapeHtml(o.first_name)} (${o.telegram_id})\n💰 ${formatPrice(o.total_amount)}\n📊 ${o.status}\n\n🛒 ${itemsText}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅', callback_data: `confirm_${o.id}` }, { text: '❌', callback_data: `cancel_${o.id}` }],
              [{ text: '🔙', callback_data: 'admin_orders' }]
            ]
          }
        });
      });
      return;
    }

    // === ТОВАРЫ ===
    if (data === 'admin_add_product' || data === 'add_product') {
      bot.deleteMessage(chatId, msgId).catch(() => {});
      adminState[chatId] = { step: 0, type: 'product' };
      bot.sendMessage(chatId, '📝 <b>Добавление товара</b>\n\n1️⃣ Отправьте название:', {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
      });
      return;
    }

    if (data === 'list_products') {
      const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 20').all();
      if (products.length === 0) {
        bot.sendMessage(chatId, '📭 Товаров нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      products.forEach(p => {
        bot.sendMessage(chatId, `📦 ${escapeHtml(p.name)}\n💰 ${formatPrice(p.price)}\n📂 Категория: ${p.category_id}\n📦 Остаток: ${p.stock}`);
      });
      bot.sendMessage(chatId, 'Список товаров', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
      });
      return;
    }

    // === НОВОСТИ ===
    if (data === 'admin_news' || data === 'add_news') {
      bot.deleteMessage(chatId, msgId).catch(() => {});
      adminState[chatId] = { step: 0, type: 'news' };
      bot.sendMessage(chatId, '📝 <b>Добавление новости</b>\n\n1️⃣ Отправьте заголовок:', {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
      });
      return;
    }

    if (data === 'list_news') {
      const news = db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 10').all();
      if (news.length === 0) {
        bot.sendMessage(chatId, '📭 Новостей нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      news.forEach(n => {
        bot.sendMessage(chatId, `📰 <b>${escapeHtml(n.title)}</b>\n\n${escapeHtml(n.content)}\n\n🕐 ${new Date(n.created_at).toLocaleString('ru-RU')}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '🗑️ Удалить', callback_data: `del_news_${n.id}` }]]
          }
        });
      });
      bot.sendMessage(chatId, 'Новости', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
      });
      return;
    }

    // === ПРОМОКОДЫ ===
    if (data === 'admin_promocodes' || data === 'add_promocode') {
      bot.deleteMessage(chatId, msgId).catch(() => {});
      adminState[chatId] = { step: 0, type: 'promocode' };
      bot.sendMessage(chatId, '🎁 <b>Создание промокода</b>\n\n1️⃣ Отправьте код (латиницей):', {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
      });
      return;
    }

    if (data === 'list_promocodes') {
      const promocodes = db.prepare('SELECT * FROM promocodes ORDER BY created_at DESC').all();
      if (promocodes.length === 0) {
        bot.sendMessage(chatId, '🎭 Промокодов нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      let msg = '🎁 <b>Промокоды</b>\n\n';
      promocodes.forEach(p => {
        msg += `<code>${escapeHtml(p.code)}</code> — ${p.discount}% (${p.uses_count}/${p.max_uses || '∞'})\n`;
      });
      bot.sendMessage(chatId, msg, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
      });
      return;
    }

    // === ПОЛЬЗОВАТЕЛИ ===
    if (data === 'admin_users') {
      const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 20').all();
      if (users.length === 0) {
        bot.sendMessage(chatId, '📭 Пользователей нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      let msg = '👥 <b>Пользователи</b>\n\n';
      users.forEach((u, i) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
        msg += `${i+1}. <b>${escapeHtml(name)}</b> (<code>${u.telegram_id}</code>)\n`;
      });
      bot.sendMessage(chatId, msg, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
      });
      return;
    }

    // Управление заказами
    if (data.startsWith('confirm_')) {
      const id = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', id);
      bot.answerCallbackQuery(query.id, { text: '✅ Подтверждено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (order) bot.sendMessage(order.user_id, '✅ Заказ подтвержден!');
      bot.deleteMessage(chatId, msgId);
      return;
    }

    if (data.startsWith('cancel_')) {
      const id = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', id);
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (order) bot.sendMessage(order.user_id, '❌ Заказ отменен');
      bot.deleteMessage(chatId, msgId);
      return;
    }

    if (data.startsWith('del_news_')) {
      const id = parseInt(data.split('_')[2]);
      db.prepare('DELETE FROM news WHERE id = ?').run(id);
      bot.answerCallbackQuery(query.id, { text: '🗑️ Удалено' });
      bot.deleteMessage(chatId, msgId);
      return;
    }
  });

  // Обработка состояний (добавление товара/новости/промокода)
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;
    if (!adminState[chatId]) return;
    
    const text = msg.text;
    if (text === '❌ Отмена') {
      delete adminState[chatId];
      bot.sendMessage(chatId, '❌ Отменено', { reply_markup: adminKbd });
      return;
    }

    const state = adminState[chatId];

    // === ДОБАВЛЕНИЕ ТОВАРА ===
    if (state.type === 'product') {
      if (state.step === 0) { state.name = text; state.step = 1; bot.sendMessage(chatId, '2️⃣ Отправьте описание:'); return; }
      if (state.step === 1) { state.description = text; state.step = 2; bot.sendMessage(chatId, '3️⃣ Отправьте цену (число):'); return; }
      if (state.step === 2) {
        const price = parseInt(text);
        if (isNaN(price) || price <= 0) { bot.sendMessage(chatId, '❌ Неверная цена:'); return; }
        state.price = price; state.step = 3; bot.sendMessage(chatId, '4️⃣ ID категории (1-4):\n1-Жидкости 2-Поды 3-Расходники 4-Наборы'); return;
      }
      if (state.step === 3) {
        const cat = parseInt(text);
        if (![1,2,3,4].includes(cat)) { bot.sendMessage(chatId, '❌ Введите 1, 2, 3 или 4:'); return; }
        state.category_id = cat; state.step = 4; bot.sendMessage(chatId, '5️⃣ Отправьте фото или "пропустить":'); return;
      }
      if (state.step === 4) {
        if (text?.toLowerCase() === 'пропустить') { state.image_url = null; }
        else if (msg.photo?.length) { state.image_url = (await bot.getFileLink(msg.photo[msg.photo.length-1].file_id)).href; }
        else { bot.sendMessage(chatId, '❌ Отправьте фото или "пропустить":'); return; }
        
        db.prepare('INSERT INTO products (category_id, name, description, price, image_url, stock) VALUES (?, ?, ?, ?, ?, ?)')
          .run(state.category_id, state.name, state.description, state.price, state.image_url, 100);
        
        bot.sendMessage(chatId, `✅ Товар добавлен!\n\n📦 ${escapeHtml(state.name)}\n💰 ${formatPrice(state.price)}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Ещё', callback_data: 'add_product' }],
              [{ text: '🔙 В меню', callback_data: 'admin_menu' }]
            ]
          }
        });
        delete adminState[chatId];
      }
    }

    // === ДОБАВЛЕНИЕ НОВОСТИ ===
    if (state.type === 'news') {
      if (state.step === 0) { state.title = text; state.step = 1; bot.sendMessage(chatId, '2️⃣ Отправьте текст новости:'); return; }
      if (state.step === 1) { state.content = text; state.step = 2; bot.sendMessage(chatId, '3️⃣ Отправьте фото или "пропустить":'); return; }
      if (state.step === 2) {
        if (text?.toLowerCase() === 'пропустить') { state.image_url = null; }
        else if (msg.photo?.length) { state.image_url = (await bot.getFileLink(msg.photo[msg.photo.length-1].file_id)).href; }
        else { bot.sendMessage(chatId, '❌ Отправьте фото или "пропустить":'); return; }
        
        db.prepare('INSERT INTO news (title, content, image_url) VALUES (?, ?, ?)').run(state.title, state.content, state.image_url);
        
        bot.sendMessage(chatId, `✅ Новость добавлена!\n\n📰 ${escapeHtml(state.title)}`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
        });
        delete adminState[chatId];
      }
    }

    // === СОЗДАНИЕ ПРОМОКОДА ===
    if (state.type === 'promocode') {
      if (state.step === 0) {
        const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 3) { bot.sendMessage(chatId, '❌ Минимум 3 символа:'); return; }
        state.code = code; state.step = 1; bot.sendMessage(chatId, '2️⃣ Размер скидки % (1-100):'); return;
      }
      if (state.step === 1) {
        const disc = parseInt(text);
        if (isNaN(disc) || disc < 1 || disc > 100) { bot.sendMessage(chatId, '❌ Введите 1-100:'); return; }
        state.discount = disc; state.step = 2; bot.sendMessage(chatId, '3️⃣ Лимит использований (0 = безлимит):'); return;
      }
      if (state.step === 2) {
        const max = parseInt(text);
        state.max_uses = max === 0 ? null : max;
        
        db.prepare('INSERT INTO promocodes (code, discount, max_uses) VALUES (?, ?, ?)').run(state.code, state.discount, state.max_uses);
        
        bot.sendMessage(chatId, `✅ Промокод создан!\n\n🎁 <code>${state.code}</code> — ${state.discount}%`, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
        });
        delete adminState[chatId];
      }
    }
  });

  // === API ===
  app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all()));
  app.get('/api/products', (req, res) => {
    const products = req.query.category_id 
      ? db.prepare('SELECT * FROM products WHERE category_id = ? AND is_active = 1').all(req.query.category_id)
      : db.prepare('SELECT * FROM products WHERE is_active = 1').all();
    res.json(products);
  });
  app.get('/api/news', (req, res) => res.json(db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 20').all()));
  app.post('/api/validate-promocode', (req, res) => {
    const pc = db.prepare('SELECT * FROM promocodes WHERE code = ? AND is_active = 1').get(req.body.code?.toUpperCase());
    if (!pc) return res.json({ valid: false, error: 'Не найден' });
    if (pc.max_uses && pc.uses_count >= pc.max_uses) return res.json({ valid: false, error: 'Исчерпан' });
    res.json({ valid: true, discount: pc.discount });
  });
  app.post('/api/orders', (req, res) => {
    const { userId, items, totalAmount, deliveryAddress, contactInfo, comment, promocode } = req.body;
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    if (!user) { db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(userId); user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId); }
    const uuid = uuidv4();
    const result = db.prepare('INSERT INTO orders (order_uuid, user_id, total_amount, delivery_address, contact_info, comment, promocode) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uuid, user.id, totalAmount, deliveryAddress, contactInfo, comment, promocode || null);
    if (promocode) db.prepare('UPDATE promocodes SET uses_count = uses_count + 1 WHERE code = ?').run(promocode.toUpperCase());
    const orderId = result.lastInsertRowid;
    const stmt = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)');
    items.forEach(i => stmt.run(orderId, i.product_id, i.name, i.quantity, i.price));
    adminIds.forEach(aid => {
      const itemsText = items.map(i => `• ${escapeHtml(i.name)} x${i.quantity}`).join('\n');
      bot.sendMessage(aid, `🔔 <b>Новый заказ!</b>\n\n📦 #${uuid.substring(0, 8)}\n👤 ${userId}\n💰 ${formatPrice(totalAmount)}\n\n🛒 ${itemsText}`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅', callback_data: `confirm_${orderId}` }, { text: '❌', callback_data: `cancel_${orderId}` }]
          ]
        }
      });
    });
    bot.sendMessage(userId, `✅ <b>Заказ #${uuid.substring(0, 8)} принят!</b>`, { parse_mode: 'HTML' });
    res.json({ success: true, orderId: uuid });
  });

  app.listen(PORT, () => console.log(`🚀 Порт ${PORT}`));
  console.log('🤖 Бот запущен');
}

start().catch(console.error);
module.exports = app;
