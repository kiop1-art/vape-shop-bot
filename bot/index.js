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
const DEFAULT_CHANNEL = process.env.CHANNEL_ID || '@vapeshop_channel';

let bot;
let app;
let WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3001';

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
  
  // Автозаполнение базы если пустая
  const cats = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (cats.c === 0) {
    console.log('📊 База пустая, заполняю...');
    
    // Категории
    const categories = [
      { name: '💧 Жидкости', description: 'Жидкости для вейпов', icon: '💧', sort_order: 1 },
      { name: '🔥 Поды', description: 'Pod-системы', icon: '🔥', sort_order: 2 },
      { name: '🔧 Расходники', description: 'Испарители, картриджи', icon: '🔧', sort_order: 3 },
      { name: '🎁 Наборы', description: 'Выгодные наборы', icon: '🎁', sort_order: 4 }
    ];
    categories.forEach(cat => {
      db.prepare('INSERT INTO categories (name, description, icon, sort_order) VALUES (?, ?, ?, ?)')
        .run(cat.name, cat.description, cat.icon, cat.sort_order);
    });
    
    // Товары
    const products = [
      { category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя', price: 450, stock: 50 },
      { category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод', price: 390, stock: 30 },
      { category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под', price: 2490, stock: 15 },
      { category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD', price: 1990, stock: 20 },
      { category_id: 3, name: 'Испарители XROS 0.6Ω', description: '4 шт', price: 890, stock: 100 },
      { category_id: 4, name: 'Стартовый набор', description: 'XROS 3 + 2 жидкости', price: 2990, stock: 10 }
    ];
    products.forEach(prod => {
      db.prepare('INSERT INTO products (category_id, name, description, price, stock) VALUES (?, ?, ?, ?, ?)')
        .run(prod.category_id, prod.name, prod.description, prod.price, prod.stock);
    });
    
    console.log('✅ База заполнена!');
  }
  
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch(e) {
    console.log('Таблица settings:', e.message);
  }
  
  const existingChannel = db.prepare('SELECT value FROM settings WHERE key = ?').get('channel_id');
  if (!existingChannel) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('channel_id', '@kiopifan');
  }

  const existingSubCheck = db.prepare('SELECT value FROM settings WHERE key = ?').get('subscription_enabled');
  if (!existingSubCheck) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('subscription_enabled', '0');
  }

  console.log('=== НАСТРОЙКИ ===');
  console.log('TOKEN:', token ? 'OK' : 'MISSING');
  console.log('ADMIN_IDS:', adminIds);
  console.log('ПРОВЕРКА ПОДПИСКИ: ВКЛЮЧЕНА');
  console.log('=================');
  
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

  function getChannelId() {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('channel_id');
    return setting?.value || DEFAULT_CHANNEL;
  }

  function setChannelId(channelId) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('channel_id', channelId);
  }

  function isSubscriptionCheckEnabled() {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('subscription_enabled');
    return setting?.value === '1';
  }

  function setSubscriptionCheckEnabled(enabled) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('subscription_enabled', enabled ? '1' : '0');
  }

  async function checkSubscription(userId) {
    const enabled = isSubscriptionCheckEnabled();
    const channelId = getChannelId();
    
    if (!enabled || !channelId) {
      return true;
    }
    
    try {
      console.log(`Проверка подписки ${userId} в ${channelId}`);
      const member = await bot.getChatMember(channelId.replace('@', ''), userId);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      console.log(`Статус: ${member.status}, подписан: ${isMember}`);
      return isMember;
    } catch (e) { 
      console.error('Ошибка проверки подписки:', e.message);
      return false;
    }
  }

  function isAdmin(userId) { return adminIds.includes(parseInt(userId)); }
  function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }

  // === КЛАВИАТУРЫ ===
  const mainKbd = {
    inline_keyboard: [[{ text: '🛒 Открыть магазин', web_app: { url: WEB_APP_URL } }]]
  };

  const adminKbd = {
    inline_keyboard: [
      [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
      [{ text: '📦 Актуальные заказы', callback_data: 'admin_orders_actual' }],
      [{ text: '✨ Завершённые заказы', callback_data: 'admin_orders_completed' }],
      [{ text: '➕ Добавить товар', callback_data: 'admin_add_product' }],
      [{ text: '🗑️ Удалить товар', callback_data: 'admin_delete_product' }],
      [{ text: '📰 Новости', callback_data: 'admin_news' }],
      [{ text: '🎁 Промокоды', callback_data: 'admin_promocodes' }],
      [{ text: '📨 Рассылка', callback_data: 'admin_broadcast' }],
      [{ text: '⚙️ Настройки', callback_data: 'admin_settings' }]
    ]
  };

  const ordersMenuKbd = {
    inline_keyboard: [
      [{ text: '📦 Актуальные', callback_data: 'admin_orders_actual' }],
      [{ text: '✨ Завершённые', callback_data: 'admin_orders_completed' }],
      [{ text: '🔙 В меню', callback_data: 'admin_menu' }]
    ]
  };

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    
    registerUser(chatId, msg.from.username, firstName, msg.from.last_name);
    
    // Всегда показываем главное меню без проверки подписки
    const kbd = isAdmin(chatId) ? adminKbd : mainKbd;
    bot.sendMessage(chatId, `👋 Привет, ${escapeHtml(firstName)}!\n\n🛍️ <b>VapeShop</b>`, {
      reply_markup: kbd,
      parse_mode: 'HTML'
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const msgId = query.message.message_id;
    const firstName = query.from.first_name;

    // Проверка админа
    if (!isAdmin(chatId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещён', show_alert: true });
      return;
    }

    // === АДМИН МЕНЮ ===
    if (data === 'admin_menu') {
      bot.editMessageText('🔑 <b>Админ-панель</b>', {
        chat_id: chatId, message_id: msgId,
        reply_markup: adminKbd,
        parse_mode: 'HTML'
      });
      return;
    }

    // === НАСТРОЙКИ ===
    if (data === 'admin_settings') {
      const channelId = getChannelId();
      const subEnabled = isSubscriptionCheckEnabled();
      bot.sendMessage(chatId, `⚙️ <b>Настройки</b>\n\n📢 Канал: <code>${escapeHtml(channelId)}</code>\n🔔 Проверка: ${subEnabled ? 'ВКЛ ✅' : 'ВЫКЛ ❌'}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Изменить канал', callback_data: 'set_channel' }],
            [{ text: subEnabled ? '🔔 Отключить' : '🔔 Включить', callback_data: 'toggle_subscription' }],
            [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
          ]
        },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'set_channel') {
      adminState[chatId] = { step: 0, type: 'set_channel' };
      bot.sendMessage(chatId, `📢 <b>Настройка канала</b>\n\nТекущий: <code>${escapeHtml(getChannelId())}</code>\n\nОтправьте новый username (например, @mychannel):`, {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
      });
      return;
    }

    if (data === 'toggle_subscription') {
      const current = isSubscriptionCheckEnabled();
      setSubscriptionCheckEnabled(!current);
      const channelId = getChannelId();
      bot.sendMessage(chatId, `✅ Проверка ${!current ? 'включена' : 'отключена'}\n\n📢 Канал: <code>${escapeHtml(channelId)}</code>`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Изменить канал', callback_data: 'set_channel' }],
            [{ text: !current ? '🔔 Отключить' : '🔔 Включить', callback_data: 'toggle_subscription' }],
            [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
          ]
        },
        parse_mode: 'HTML'
      });
      return;
    }

    // === СТАТИСТИКА ===
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

    // === ЗАКАЗЫ - АКТУАЛЬНЫЕ ===
    if (data === 'admin_orders_actual') {
      const orders = db.prepare(`
        SELECT o.*, u.first_name, u.telegram_id 
        FROM orders o 
        JOIN users u ON o.user_id = u.id 
        WHERE o.status IN ('pending', 'confirmed', 'shipping')
        ORDER BY o.created_at DESC 
        LIMIT 20
      `).all();
      
      if (orders.length === 0) {
        bot.sendMessage(chatId, '📭 Актуальных заказов нет', {
          reply_markup: ordersMenuKbd
        });
        return;
      }
      
      orders.forEach(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        const itemsText = items.map(i => `• ${escapeHtml(i.product_name)} x${i.quantity}`).join('\n');
        
        const statusEmojis = {
          'pending': '⏳',
          'confirmed': '✅',
          'shipping': '🚀'
        };
        
        bot.sendMessage(chatId, `📦 <b>Заказ #${order.order_uuid.substring(0, 8)}</b>
${statusEmojis[order.status] || '📦'} <b>Актуальный</b>

👤 ${escapeHtml(order.first_name)} (<code>${order.telegram_id}</code>)
💰 ${formatPrice(order.total_amount)}
📊 ${order.status}

📞 ${escapeHtml(order.contact_info) || '—'}
📍 ${escapeHtml(order.delivery_address) || '—'}

🛒 ${itemsText}

🕐 ${new Date(order.created_at).toLocaleString('ru-RU')}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Принять', callback_data: `confirm_${order.id}` }, { text: '❌ Отклонить', callback_data: `cancel_${order.id}` }],
              [{ text: '✨ Завершить', callback_data: `complete_${order.id}` }],
              [{ text: '📦 Меню заказов', callback_data: 'admin_orders_menu' }]
            ]
          }
        });
      });
      
      bot.sendMessage(chatId, '📦 <b>Актуальные заказы</b>', {
        reply_markup: ordersMenuKbd,
        parse_mode: 'HTML'
      });
      return;
    }

    // === ЗАКАЗЫ - ЗАВЕРШЁННЫЕ ===
    if (data === 'admin_orders_completed') {
      const orders = db.prepare(`
        SELECT o.*, u.first_name, u.telegram_id 
        FROM orders o 
        JOIN users u ON o.user_id = u.id 
        WHERE o.status IN ('completed', 'cancelled')
        ORDER BY o.created_at DESC 
        LIMIT 20
      `).all();
      
      if (orders.length === 0) {
        bot.sendMessage(chatId, '✨ Завершённых заказов нет', {
          reply_markup: ordersMenuKbd
        });
        return;
      }
      
      orders.forEach(order => {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        const itemsText = items.map(i => `• ${escapeHtml(i.product_name)} x${i.quantity}`).join('\n');
        
        const statusEmojis = {
          'completed': '✨',
          'cancelled': '❌'
        };
        
        bot.sendMessage(chatId, `📦 <b>Заказ #${order.order_uuid.substring(0, 8)}</b>
${statusEmojis[order.status] || '📦'} <b>Завершённый</b>

👤 ${escapeHtml(order.first_name)} (<code>${order.telegram_id}</code>)
💰 ${formatPrice(order.total_amount)}
📊 ${order.status}

📞 ${escapeHtml(order.contact_info) || '—'}
📍 ${escapeHtml(order.delivery_address) || '—'}

🛒 ${itemsText}

🕐 ${new Date(order.created_at).toLocaleString('ru-RU')}`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 В актуальные', callback_data: 'admin_orders_actual' }],
              [{ text: '📦 Меню заказов', callback_data: 'admin_orders_menu' }]
            ]
          }
        });
      });
      
      bot.sendMessage(chatId, '✨ <b>Завершённые заказы</b>', {
        reply_markup: ordersMenuKbd,
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'admin_orders_menu') {
      bot.sendMessage(chatId, '📦 <b>Управление заказами</b>', {
        reply_markup: ordersMenuKbd,
        parse_mode: 'HTML'
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

    if (data === 'admin_delete_product') {
      const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 20').all();
      if (products.length === 0) {
        bot.sendMessage(chatId, '📭 Товаров нет', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
        });
        return;
      }
      const keyboard = [];
      for (let i = 0; i < products.length; i += 2) {
        const row = [];
        row.push({ text: `🗑️ ${products[i].name.substring(0, 20)}`, callback_data: `del_product_${products[i].id}` });
        if (products[i+1]) {
          row.push({ text: `🗑️ ${products[i+1].name.substring(0, 20)}`, callback_data: `del_product_${products[i+1].id}` });
        }
        keyboard.push(row);
      }
      keyboard.push([{ text: '🔙 Назад', callback_data: 'admin_menu' }]);
      bot.sendMessage(chatId, '🗑️ <b>Удаление товара</b>\n\nВыберите товар:', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data.startsWith('del_product_')) {
      const productId = parseInt(data.split('_')[2]);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (product) {
        db.prepare('DELETE FROM products WHERE id = ?').run(productId);
        bot.answerCallbackQuery(query.id, { text: `✅ "${product.name}" удалён`, show_alert: true });
        bot.deleteMessage(chatId, msgId);
        bot.emit('callback_query', { message: { chat: { id: chatId }, message_id: msgId }, from: query.from, data: 'admin_delete_product' });
      }
      return;
    }

    // === НОВОСТИ ===
    if (data === 'admin_news') {
      bot.sendMessage(chatId, '📰 <b>Новости</b>', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Добавить', callback_data: 'add_news' }],
            [{ text: '📰 Список', callback_data: 'list_news' }],
            [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
          ]
        },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'add_news') {
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
      const keyboard = [];
      news.forEach(n => {
        keyboard.push([{ text: `🗑️ ${n.title.substring(0, 30)}`, callback_data: `del_news_${n.id}`}]);
      });
      keyboard.push([{ text: '🔙 Назад', callback_data: 'admin_menu' }]);
      bot.sendMessage(chatId, '🗑️ <b>Удаление новости</b>\n\nВыберите:', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data.startsWith('del_news_')) {
      const newsId = parseInt(data.split('_')[2]);
      db.prepare('DELETE FROM news WHERE id = ?').run(newsId);
      bot.answerCallbackQuery(query.id, { text: '✅ Удалено', show_alert: true });
      bot.deleteMessage(chatId, msgId);
      bot.emit('callback_query', { message: { chat: { id: chatId }, message_id: msgId }, from: query.from, data: 'list_news' });
      return;
    }

    // === РАССЫЛКА ===
    if (data === 'admin_broadcast') {
      adminState[chatId] = { step: 0, type: 'broadcast' };
      bot.sendMessage(chatId, '📨 <b>Рассылка всем пользователям</b>\n\nОтправьте текст сообщения (можно с фото, видео, файлами):', {
        parse_mode: 'HTML',
        reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
      });
      return;
    }

    const state = adminState[chatId];
    if (state && state.type === 'broadcast') {
      if (state.step === 0) {
        state.message = msg;
        state.step = 1;
        bot.sendMessage(chatId, '📨 Отправляем сообщение всем пользователям?\n\nНажмите "Да" для подтверждения:', {
          reply_markup: { inline_keyboard: [[{ text: '✅ Да', callback_data: 'broadcast_confirm' }], [{ text: '❌ Нет', callback_data: 'broadcast_cancel' }]] }
        });
        return;
      }
    }

    if (data === 'broadcast_confirm') {
      const state = adminState[chatId];
      if (!state || state.type !== 'broadcast') return;
      
      bot.deleteMessage(chatId, msgId);
      bot.sendMessage(chatId, '📨 Рассылка началась...');
      
      const users = db.prepare('SELECT telegram_id FROM users').all();
      let success = 0;
      let failed = 0;
      
      users.forEach((u, i) => {
        try {
          if (state.message.text) {
            bot.sendMessage(u.telegram_id, state.message.text, { parse_mode: 'HTML' });
          }
          if (state.message.photo) {
            bot.sendPhoto(u.telegram_id, state.message.photo[state.message.photo.length - 1].file_id);
          }
          if (state.message.document) {
            bot.sendDocument(u.telegram_id, state.message.document.file_id);
          }
          success++;
        } catch (e) {
          failed++;
        }
        
        // Прогресс каждые 50 сообщений
        if ((i + 1) % 50 === 0) {
          bot.sendMessage(chatId, `📨 Прогресс: ${i + 1}/${users.length}`);
        }
      });
      
      bot.sendMessage(chatId, `✅ <b>Рассылка завершена!</b>\n\n📤 Отправлено: ${success}\n❌ Ошибок: ${failed}\n👥 Всего: ${users.length}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
      });
      
      delete adminState[chatId];
      return;
    }

    if (data === 'broadcast_cancel') {
      delete adminState[chatId];
      bot.deleteMessage(chatId, msgId);
      bot.sendMessage(chatId, '❌ Рассылка отменена', {
        reply_markup: adminKbd
      });
      return;
    }

    // === ПРОМОКОДЫ ===
    if (data === 'admin_promocodes') {
      bot.sendMessage(chatId, '🎁 <b>Промокоды</b>', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Создать', callback_data: 'add_promocode' }],
            [{ text: '📋 Список', callback_data: 'list_promocodes' }],
            [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
          ]
        },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'add_promocode') {
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
      const keyboard = [];
      promocodes.forEach(p => {
        keyboard.push([{ text: `🗑️ ${p.code} (${p.discount}%)`, callback_data: `del_promocode_${p.id}`}]);
      });
      keyboard.push([{ text: '🔙 Назад', callback_data: 'admin_menu' }]);
      bot.sendMessage(chatId, '🗑️ <b>Удаление промокода</b>\n\nВыберите:', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'HTML'
      });
      return;
    }

    if (data.startsWith('del_promocode_')) {
      const promoId = parseInt(data.split('_')[2]);
      db.prepare('DELETE FROM promocodes WHERE id = ?').run(promoId);
      bot.answerCallbackQuery(query.id, { text: '✅ Удалено', show_alert: true });
      bot.deleteMessage(chatId, msgId);
      bot.emit('callback_query', { message: { chat: { id: chatId }, message_id: msgId }, from: query.from, data: 'list_promocodes' });
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

    // === УПРАВЛЕНИЕ ЗАКАЗАМИ ===
    if (data.startsWith('confirm_')) {
      const id = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', id);
      bot.answerCallbackQuery(query.id, { text: '✅ Принят', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (order) bot.sendMessage(order.user_id, '✅ Ваш заказ принят в работу!');
      bot.deleteMessage(chatId, msgId);
      return;
    }

    if (data.startsWith('cancel_')) {
      const id = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', id);
      bot.answerCallbackQuery(query.id, { text: '❌ Отклонён', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (order) bot.sendMessage(order.user_id, '❌ Ваш заказ отменён');
      bot.deleteMessage(chatId, msgId);
      return;
    }

    if (data.startsWith('complete_')) {
      const id = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', id);
      bot.answerCallbackQuery(query.id, { text: '✨ Завершён', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (order) bot.sendMessage(order.user_id, '✨ Ваш заказ завершён! Спасибо за покупку!');
      bot.deleteMessage(chatId, msgId);
      return;
    }
  });

  // === ОБРАБОТКА СООБЩЕНИЙ ===
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!isAdmin(chatId)) return;
    if (!adminState[chatId]) return;
    if (text === '❌ Отмена') {
      delete adminState[chatId];
      bot.sendMessage(chatId, '❌ Отменено', { reply_markup: adminKbd });
      return;
    }

    const state = adminState[chatId];

    // === НАСТРОЙКА КАНАЛА ===
    if (state.type === 'set_channel') {
      const channelId = text.trim();
      if (!channelId.startsWith('@')) {
        bot.sendMessage(chatId, '❌ Username должен начинаться с @:');
        return;
      }
      setChannelId(channelId);
      bot.sendMessage(chatId, `✅ Канал изменён на <code>${escapeHtml(channelId)}</code>`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
      });
      delete adminState[chatId];
      return;
    }

    // === ДОБАВЛЕНИЕ ТОВАРА ===
    if (state.type === 'product') {
      if (state.step === 0) { state.name = text; state.step = 1; bot.sendMessage(chatId, '2️⃣ Описание:'); return; }
      if (state.step === 1) { state.description = text; state.step = 2; bot.sendMessage(chatId, '3️⃣ Цена (число):'); return; }
      if (state.step === 2) {
        const price = parseInt(text);
        if (isNaN(price) || price <= 0) { bot.sendMessage(chatId, '❌ Неверная цена:'); return; }
        state.price = price; state.step = 3; bot.sendMessage(chatId, '4️⃣ ID категории (1-4):'); return;
      }
      if (state.step === 3) {
        const cat = parseInt(text);
        if (![1,2,3,4].includes(cat)) { bot.sendMessage(chatId, '❌ Введите 1-4:'); return; }
        state.category_id = cat; state.step = 4; bot.sendMessage(chatId, '5️⃣ Отправьте ФОТО товара (как файл) или напишите "пропустить":'); return;
      }
      if (state.step === 4) {
        // Обработка фото
        if (text && text.toLowerCase() === 'пропустить') {
          state.image_url = null;
          state.step = 6;
        } else if (msg.photo && msg.photo.length > 0) {
          // Получаем фото в максимальном качестве
          const photo = msg.photo[msg.photo.length - 1];
          bot.getFileLink(photo.file_id).then(fileLink => {
            state.image_url = fileLink.href;
            console.log('✅ Фото товара загружено:', state.image_url);
            state.step = 6;
          }).catch(err => {
            console.error('❌ Ошибка загрузки фото:', err);
            bot.sendMessage(chatId, '❌ Ошибка загрузки фото. Попробуйте ещё раз или "пропустить":');
            return;
          });
          return;
        } else if (msg.document && msg.document.mime_type.startsWith('image/')) {
          // Если отправили как документ
          const doc = msg.document;
          bot.getFileLink(doc.file_id).then(fileLink => {
            state.image_url = fileLink.href;
            console.log('✅ Фото товара (документ) загружено:', state.image_url);
            state.step = 6;
          }).catch(err => {
            console.error('❌ Ошибка загрузки фото:', err);
            bot.sendMessage(chatId, '❌ Ошибка загрузки фото. Попробуйте ещё раз или "пропустить":');
            return;
          });
          return;
        } else {
          bot.sendMessage(chatId, '❌ Отправьте ФОТО (как файл или изображение) или напишите "пропустить":');
          return;
        }
      }
      if (state.step === 6) {
        try {
          db.prepare('INSERT INTO products (category_id, name, description, price, image_url, stock) VALUES (?, ?, ?, ?, ?, ?)')
            .run(state.category_id, state.name, state.description, state.price, state.image_url, 100);
          
          bot.sendMessage(chatId, `✅ Товар добавлен!\n\n📦 ${escapeHtml(state.name)}\n💰 ${formatPrice(state.price)}\n${state.image_url ? '🖼️ Фото: загружено' : '🖼️ Фото: нет'}`, {
            reply_markup: { inline_keyboard: [[{ text: '➕ Ещё', callback_data: 'add_product' }], [{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
          });
        } catch (e) {
          bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(e.message)}`);
        }
        delete adminState[chatId];
      }
    }

    // === ДОБАВЛЕНИЕ НОВОСТИ ===
    if (state.type === 'news') {
      if (state.step === 0) { state.title = text; state.step = 1; bot.sendMessage(chatId, '2️⃣ Текст новости:'); return; }
      if (state.step === 1) { state.content = text; state.step = 2; bot.sendMessage(chatId, '3️⃣ Отправьте ФОТО новости или напишите "пропустить":'); return; }
      if (state.step === 2) {
        if (text && text.toLowerCase() === 'пропустить') {
          state.image_url = null;
          state.step = 4;
        } else if (msg.photo && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          bot.getFileLink(photo.file_id).then(fileLink => {
            state.image_url = fileLink.href;
            console.log('✅ Фото новости загружено:', state.image_url);
            state.step = 4;
          }).catch(err => {
            console.error('❌ Ошибка загрузки фото:', err);
            bot.sendMessage(chatId, '❌ Ошибка загрузки фото. Попробуйте ещё раз или "пропустить":');
            return;
          });
          return;
        } else if (msg.document && msg.document.mime_type.startsWith('image/')) {
          const doc = msg.document;
          bot.getFileLink(doc.file_id).then(fileLink => {
            state.image_url = fileLink.href;
            console.log('✅ Фото новости (документ) загружено:', state.image_url);
            state.step = 4;
          }).catch(err => {
            console.error('❌ Ошибка загрузки фото:', err);
            bot.sendMessage(chatId, '❌ Ошибка загрузки фото. Попробуйте ещё раз или "пропустить":');
            return;
          });
          return;
        } else {
          bot.sendMessage(chatId, '❌ Отправьте ФОТО или напишите "пропустить":');
          return;
        }
      }
      if (state.step === 4) {
        try {
          db.prepare('INSERT INTO news (title, content, image_url) VALUES (?, ?, ?)').run(state.title, state.content, state.image_url);
          bot.sendMessage(chatId, `✅ Новость добавлена!\n\n📰 ${escapeHtml(state.title)}${state.image_url ? '\n🖼️ Фото: загружено' : ''}`, {
            reply_markup: { inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'admin_menu' }]] }
          });
        } catch (e) {
          bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(e.message)}`);
        }
        delete adminState[chatId];
      }
    }

    // === СОЗДАНИЕ ПРОМОКОДА ===
    if (state.type === 'promocode') {
      if (state.step === 0) {
        const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 3) { bot.sendMessage(chatId, '❌ Минимум 3 символа:'); return; }
        state.code = code; state.step = 1; bot.sendMessage(chatId, '2️⃣ Скидка % (1-100):'); return;
      }
      if (state.step === 1) {
        const disc = parseInt(text);
        if (isNaN(disc) || disc < 1 || disc > 100) { bot.sendMessage(chatId, '❌ Введите 1-100:'); return; }
        state.discount = disc; state.step = 2; bot.sendMessage(chatId, '3️⃣ Лимит (0 = безлимит):'); return;
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
  app.get('/api/categories', (req, res) => {
    const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    res.json(cats);
  });
  
  app.get('/api/products', (req, res) => {
    const products = req.query.category_id 
      ? db.prepare('SELECT * FROM products WHERE category_id = ? AND is_active = 1').all(req.query.category_id)
      : db.prepare('SELECT * FROM products WHERE is_active = 1').all();
    res.json(products);
  });
  
  app.get('/api/news', (req, res) => {
    const n = db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 20').all();
    res.json(n);
  });
  
  app.get('/api/orders', (req, res) => {
    const userId = parseInt(req.query.user_id);
    if (!userId) return res.json([]);
    
    const user = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(userId);
    if (!user) return res.json([]);
    
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(user.id);
    
    orders.forEach(order => {
      order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    });
    
    res.json(orders);
  });
  
  // API для проверки подписки
  app.get('/api/check-subscription', async (req, res) => {
    const userId = parseInt(req.query.user_id);
    if (!userId) return res.json({ subscribed: false, error: 'No user_id' });
    
    const enabled = isSubscriptionCheckEnabled();
    const channelId = getChannelId();
    
    if (!enabled || !channelId) {
      return res.json({ subscribed: true, message: 'Check disabled' });
    }
    
    try {
      const member = await bot.getChatMember(channelId.replace('@', ''), userId);
      const isMember = ['member', 'administrator', 'creator'].includes(member.status);
      res.json({ subscribed: isMember, channel: channelId });
    } catch (e) {
      res.json({ subscribed: false, error: e.message, channel: channelId });
    }
  });
  
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
      bot.sendMessage(aid, `🔔 <b>Новый заказ!</b>\n\n📦 #${uuid.substring(0, 8)}\n👤 ID: ${userId}\n💰 ${formatPrice(totalAmount)}\n📞 ${escapeHtml(contactInfo)}\n📍 ${escapeHtml(deliveryAddress) || '—'}\n\n🛒 ${itemsText}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '✅', callback_data: `confirm_${orderId}` }, { text: '❌', callback_data: `cancel_${orderId}` }]] }
      });
    });
    bot.sendMessage(userId, `✅ <b>Заказ #${uuid.substring(0, 8)} принят!</b>`, { parse_mode: 'HTML' });
    res.json({ success: true, orderId: uuid });
  });

  app.listen(PORT, () => console.log(`🚀 Порт ${PORT}`));
  console.log('🤖 Бот запущен!');
}

start().catch(console.error);
module.exports = app;
