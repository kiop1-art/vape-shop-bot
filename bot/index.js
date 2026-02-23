require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const keyboards = require('./keyboards');

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const PORT = process.env.PORT || 8080;
const CHANNEL_ID = process.env.CHANNEL_ID || '@vapeshop_channel';

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
    const allowed = /jpeg|jpg|png|webp|mp4|mov/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// HTML escaping
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function start() {
  await db.initDatabase();
  console.log('✅ База данных инициализирована');
  
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
    } catch (e) { console.error('Ошибка регистрации:', e); }
  }

  async function checkSubscription(userId) {
    try {
      const member = await bot.getChatMember(CHANNEL_ID.replace('@', ''), userId);
      return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (e) {
      return false;
    }
  }

  function isAdmin(userId) { return adminIds.includes(parseInt(userId)); }
  function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }
  function getStatusEmoji(status) {
    const emojis = { pending: '⏳', confirmed: '✅', shipping: '🚀', completed: '✨', cancelled: '❌' };
    return emojis[status] || '📦';
  }

  async function handleStart(msg, checkSub = true) {
    const chatId = msg.chat.id;
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    if (checkSub) {
      const isSubscribed = await checkSubscription(chatId);
      if (!isSubscribed) {
        bot.sendMessage(chatId, `⚠️ <b>Для использования бота необходимо подписаться на наш канал!</b>

📢 Присоединяйтесь к ${escapeHtml(CHANNEL_ID)}

После подписки нажмите кнопку ниже:`, {
          reply_markup: {
            inline_keyboard: [[{ text: '✅ Я подписался', callback_data: 'check_subscription' }]]
          },
          parse_mode: 'HTML'
        });
        return;
      }
    }
    
    bot.sendMessage(chatId, `👋 Привет, ${escapeHtml(msg.from.first_name)}!

🛍️ <b>VapeShop</b> — твой магазин

📱 Нажми кнопку ниже:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: WEB_APP_URL } }]]
      },
      parse_mode: 'HTML'
    });
    
    if (isAdmin(chatId)) {
      setTimeout(() => {
        bot.sendMessage(chatId, '🔑 <b>Админ-панель</b>\n\nВыберите раздел:', {
          reply_markup: keyboards.adminKeyboard,
          parse_mode: 'HTML'
        });
      }, 500);
    }
  }

  bot.onText(/\/start/, (msg) => handleStart(msg, true));

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    if (data === 'check_subscription') {
      const isSubscribed = await checkSubscription(chatId);
      if (isSubscribed) {
        bot.deleteMessage(chatId, messageId);
        handleStart({ chat: { id: chatId }, from: query.from }, false);
      } else {
        bot.answerCallbackQuery(query.id, { 
          text: '❌ Вы ещё не подписались! Подпишитесь на канал.', 
          show_alert: true 
        });
      }
      return;
    }

    if (!isAdmin(chatId)) {
      bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещён', show_alert: true });
      return;
    }

    if (data.startsWith('confirm_')) {
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Подтверждено', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✅ Ваш заказ #${order.order_uuid.substring(0, 8)} подтвержден!`);
        try {
          bot.editMessageReplyMarkup({ 
            inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'confirmed').inline_keyboard 
          }, { chat_id: chatId, message_id: messageId });
        } catch(e) {}
      }
      return;
    }

    if (data.startsWith('cancel_')) {
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `❌ Заказ #${order.order_uuid.substring(0, 8)} отменен`);
        try {
          bot.editMessageReplyMarkup({ 
            inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'cancelled').inline_keyboard 
          }, { chat_id: chatId, message_id: messageId });
        } catch(e) {}
      }
      return;
    }

    if (data.startsWith('shipping_')) {
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('shipping', orderId);
      bot.answerCallbackQuery(query.id, { text: '🚀 В доставке', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `🚀 Заказ #${order.order_uuid.substring(0, 8)} в доставке!`);
        try {
          bot.editMessageReplyMarkup({ 
            inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'shipping').inline_keyboard 
          }, { chat_id: chatId, message_id: messageId });
        } catch(e) {}
      }
      return;
    }

    if (data.startsWith('complete_')) {
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✨ Завершено', show_alert: true });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✨ Заказ #${order.order_uuid.substring(0, 8)} завершен!`);
        try {
          bot.editMessageReplyMarkup({ 
            inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'completed').inline_keyboard 
          }, { chat_id: chatId, message_id: messageId });
        } catch(e) {}
      }
      return;
    }

    if (data.startsWith('delete_news_')) {
      const newsId = parseInt(data.split('_')[2]);
      db.prepare('DELETE FROM news WHERE id = ?').run(newsId);
      bot.answerCallbackQuery(query.id, { text: '🗑️ Удалено', show_alert: true });
      bot.deleteMessage(chatId, messageId);
      return;
    }

    if (data === 'back_admin') {
      bot.deleteMessage(chatId, messageId).catch(() => {});
      bot.sendMessage(chatId, '🔑 <b>Админ-панель</b>\n\nВыберите раздел:', {
        reply_markup: keyboards.adminKeyboard,
        parse_mode: 'HTML'
      });
      return;
    }

    if (data === 'add_another_product') {
      bot.deleteMessage(chatId, messageId);
      startAddProduct(chatId);
      return;
    }

    if (data === 'refresh_news') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId).catch(() => {});
      showNewsList(chatId);
      return;
    }

    if (data === 'refresh_promocodes') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId).catch(() => {});
      showPromocodesList(chatId);
      return;
    }

    if (data === 'refresh_users') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId).catch(() => {});
      showUsersList(chatId);
      return;
    }
  });

  bot.onText(/🛒 Каталог/, async (msg) => {
    const isSubscribed = await checkSubscription(msg.chat.id);
    if (!isSubscribed) {
      bot.sendMessage(msg.chat.id, `⚠️ Сначала подпишитесь на канал: ${escapeHtml(CHANNEL_ID)}`, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Я подписался', callback_data: 'check_subscription' }]] }
      });
      return;
    }
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    bot.sendMessage(msg.chat.id, '📂 Выберите категорию:', {
      reply_markup: keyboards.categoriesKeyboard(categories)
    });
  });

  bot.onText(/📰 Новости/, (msg) => {
    if (isAdmin(msg.chat.id)) {
      showNewsList(msg.chat.id);
    } else {
      bot.sendMessage(msg.chat.id, '📰 Новости магазина');
    }
  });

  bot.onText(/👤 Профиль/, (msg) => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(msg.chat.id);
    if (!user) return;
    const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(user.id).count;
    const totalSpent = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != \'cancelled\'').get(user.id).total;
    
    bot.sendMessage(msg.chat.id, `👤 <b>Профиль</b>

📛 ${escapeHtml(user.first_name)} ${escapeHtml(user.last_name) || ''}
🆔 <code>${user.telegram_id}</code>
📅 ${new Date(user.created_at).toLocaleDateString('ru-RU')}

📦 Заказов: ${ordersCount}
💰 Потрачено: ${formatPrice(totalSpent)}`, {
      parse_mode: 'HTML'
    });
  });

  bot.onText(/📞 Поддержка/, (msg) => {
    bot.sendMessage(msg.chat.id, `📞 <b>Поддержка</b>

💬 @vapeshop_support
⏰ 10:00 - 22:00 МСК`, {
      parse_mode: 'HTML'
    });
  });

  bot.onText(/📦 Мои заказы/, (msg) => {
    const user = db.prepare('SELECT id FROM users WHERE telegram_id = ?').get(msg.chat.id);
    if (!user) return;
    
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(user.id);
    if (orders.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 У вас пока нет заказов');
      return;
    }
    
    orders.forEach(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const itemsText = items.map(i => `• ${escapeHtml(i.product_name)} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(msg.chat.id, `📦 <b>Заказ #${order.order_uuid.substring(0, 8)}</b>

💰 ${formatPrice(order.total_amount)}
📊 ${getStatusEmoji(order.status)} ${order.status}
🕐 ${new Date(order.created_at).toLocaleString('ru-RU')}

🛒 Товары:
${itemsText}`, {
        parse_mode: 'HTML'
      });
    });
  });

  bot.onText(/🔑 Админ-панель/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🔑 <b>Админ-панель</b>\n\nВыберите раздел:', {
      reply_markup: keyboards.adminKeyboard,
      parse_mode: 'HTML'
    });
  });

  bot.onText(/📊 Статистика/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const revenue = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != \'cancelled\'').get().total;
    
    bot.sendMessage(msg.chat.id, `📊 <b>Статистика</b>

👥 ${totalUsers}
🛍️ ${totalProducts}
📦 ${totalOrders}
💰 ${formatPrice(revenue)}`, {
      parse_mode: 'HTML'
    });
  });

  bot.onText(/📦 Заказы/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const orders = db.prepare('SELECT o.*, u.first_name, u.last_name, u.telegram_id FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 10').all();
    if (orders.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Заказов нет');
      return;
    }
    orders.forEach(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const itemsText = items.map(i => `• ${escapeHtml(i.product_name)} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(msg.chat.id, `📦 #${order.order_uuid.substring(0, 8)}

👤 ${escapeHtml(order.first_name)} (<code>${order.telegram_id}</code>)
💰 ${formatPrice(order.total_amount)}
📊 ${getStatusEmoji(order.status)} ${order.status}

🛒 ${itemsText}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.orderStatusKeyboard(order.id, order.status)
      });
    });
  });

  bot.onText(/🛍️ Товары/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🛍️ <b>Управление товарами</b>', {
      reply_markup: keyboards.productsAdminKeyboard,
      parse_mode: 'HTML'
    });
  });

  bot.onText(/👥 Пользователи/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showUsersList(msg.chat.id);
  });

  bot.onText(/🔙 В меню/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🔑 <b>Админ-панель</b>\n\nВыберите раздел:', {
      reply_markup: keyboards.adminKeyboard,
      parse_mode: 'HTML'
    });
  });

  bot.onText(/🔙 Назад/, (msg) => {
    bot.sendMessage(msg.chat.id, '📂 <b>Меню</b>', {
      reply_markup: keyboards.mainKeyboard,
      parse_mode: 'HTML'
    });
  });

  function startAddProduct(chatId) {
    adminState[chatId] = { step: 0, type: 'product' };
    bot.sendMessage(chatId, '📝 <b>Добавление товара</b>\n\n<b>Шаг 1/5:</b> Отправьте <b>название</b> товара:', {
      parse_mode: 'HTML',
      reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
    });
  }

  bot.onText(/➕ Добавить товар/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    startAddProduct(msg.chat.id);
  });

  function startAddNews(chatId) {
    adminState[chatId] = { step: 0, type: 'news' };
    bot.sendMessage(chatId, '📝 <b>Добавление новости</b>\n\n<b>Шаг 1/3:</b> Отправьте <b>заголовок</b>:', {
      parse_mode: 'HTML',
      reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
    });
  }

  bot.onText(/📰 Добавить новость/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    startAddNews(msg.chat.id);
  });

  function showNewsList(chatId) {
    const news = db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 10').all();
    if (news.length === 0) {
      bot.sendMessage(chatId, '📭 Новостей пока нет');
      return;
    }
    news.forEach(n => {
      bot.sendMessage(chatId, `📰 <b>${escapeHtml(n.title)}</b>\n\n${escapeHtml(n.content)}\n\n🕐 ${new Date(n.created_at).toLocaleString('ru-RU')}`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🗑️ Удалить', callback_data: `delete_news_${n.id}` }]]
        }
      });
    });
    bot.sendMessage(chatId, '📰 <b>Новости</b>', {
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'refresh_news' }]] },
      parse_mode: 'HTML'
    });
  }

  function startAddPromocode(chatId) {
    adminState[chatId] = { step: 0, type: 'promocode' };
    bot.sendMessage(chatId, '🎁 <b>Создание промокода</b>\n\n<b>Шаг 1/3:</b> Отправьте <b>код</b> (латиницей, без пробелов):', {
      parse_mode: 'HTML',
      reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
    });
  }

  bot.onText(/🎁 Создать промокод/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    startAddPromocode(msg.chat.id);
  });

  bot.onText(/🎁 Промокоды/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    showPromocodesList(msg.chat.id);
  });

  function showPromocodesList(chatId) {
    const promocodes = db.prepare('SELECT * FROM promocodes ORDER BY created_at DESC').all();
    if (promocodes.length === 0) {
      bot.sendMessage(chatId, '🎭 Промокодов пока нет');
      return;
    }
    let message = '🎁 <b>Промокоды</b>\n\n';
    promocodes.forEach(p => {
      const isActive = p.is_active ? '✅' : '❌';
      const uses = p.max_uses ? `${p.uses_count}/${p.max_uses}` : `${p.uses_count}/∞`;
      message += `${isActive} <code>${escapeHtml(p.code)}</code> — ${p.discount}%\n`;
      message += `   Использован: ${uses}\n\n`;
    });
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'refresh_promocodes' }]] }
    });
  }

  function showUsersList(chatId) {
    const users = db.prepare(`
      SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u LEFT JOIN orders o ON u.id = o.user_id
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 20
    `).all();
    if (users.length === 0) {
      bot.sendMessage(chatId, '📭 Пользователей нет');
      return;
    }
    let message = '👥 <b>Пользователи</b>\n\n';
    users.forEach((u, i) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
      const username = u.username ? `@${escapeHtml(u.username)}` : '—';
      message += `${i + 1}. <b>${escapeHtml(name)}</b>\n`;
      message += `   Username: ${username}\n`;
      message += `   ID: <code>${u.telegram_id}</code>\n`;
      message += `   📦 ${u.order_count} заказов | 💰 ${formatPrice(u.total_spent)}\n\n`;
    });
    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'refresh_users' }]] }
    });
  }

  bot.onText(/❌ Отмена/, (msg) => {
    delete adminState[msg.chat.id];
    bot.sendMessage(msg.chat.id, '❌ Отменено', {
      reply_markup: keyboards.adminKeyboard
    });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;
    if (!adminState[chatId]) return;
    
    const text = msg.text;
    if (text === '❌ Отмена') {
      delete adminState[chatId];
      return;
    }

    const state = adminState[chatId];

    // ===== ДОБАВЛЕНИЕ ТОВАРА =====
    if (state.type === 'product') {
      if (state.step === 0) {
        state.name = text;
        state.step = 1;
        bot.sendMessage(chatId, '✅ Название сохранено.\n\n<b>Шаг 2/5:</b> Отправьте <b>описание</b>:', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 1) {
        state.description = text;
        state.step = 2;
        bot.sendMessage(chatId, '✅ Описание сохранено.\n\n<b>Шаг 3/5:</b> Отправьте <b>цену</b> (число в рублях):', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 2) {
        const price = parseInt(text);
        if (isNaN(price) || price <= 0) {
          bot.sendMessage(chatId, '❌ Неверная цена. Отправьте число больше 0:');
          return;
        }
        state.price = price;
        state.step = 3;
        bot.sendMessage(chatId, '✅ Цена сохранена.\n\n<b>Шаг 4/5:</b> Отправьте <b>ID категории</b>:\n\n1 — 💧 Жидкости\n2 — 🔥 Поды\n3 — 🔧 Расходники\n4 — 🎁 Наборы', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 3) {
        const categoryId = parseInt(text);
        if (![1, 2, 3, 4].includes(categoryId)) {
          bot.sendMessage(chatId, '❌ Неверный ID. Отправьте 1, 2, 3 или 4:');
          return;
        }
        state.category_id = categoryId;
        state.step = 4;
        bot.sendMessage(chatId, '✅ Категория сохранена.\n\n<b>Шаг 5/5:</b> Отправьте <b>фото</b> товара или напишите "пропустить":', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 4) {
        if (text && text.toLowerCase() === 'пропустить') {
          state.image_url = null;
          state.step = 6;
        } else if (msg.photo && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          const fileLink = await bot.getFileLink(photo.file_id);
          state.image_url = fileLink.href;
          state.step = 6;
        } else {
          bot.sendMessage(chatId, '❌ Отправьте фото (как файл) или напишите "пропустить":');
          return;
        }
      }
      if (state.step === 6) {
        try {
          db.prepare(`
            INSERT INTO products (category_id, name, description, price, image_url, stock)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(state.category_id, state.name, state.description, state.price, state.image_url, 100);
          
          const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(state.category_id);
          
          bot.sendMessage(chatId, `✅ <b>Товар добавлен!</b>

📦 ${escapeHtml(state.name)}
💰 ${formatPrice(state.price)}
📂 ${category?.name || '—'}
${state.image_url ? '🖼️ Фото: загружено' : '🖼️ Фото: нет'}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ Добавить ещё', callback_data: 'add_another_product' }],
                [{ text: '🔙 В меню', callback_data: 'back_admin' }]
              ]
            }
          });
        } catch (e) {
          bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(e.message)}`);
        }
        delete adminState[chatId];
        return;
      }
    }

    // ===== ДОБАВЛЕНИЕ НОВОСТИ =====
    if (state.type === 'news') {
      if (state.step === 0) {
        state.title = text;
        state.step = 1;
        bot.sendMessage(chatId, '✅ Заголовок сохранён.\n\n<b>Шаг 2/3:</b> Отправьте <b>текст новости</b>:', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 1) {
        state.content = text;
        state.step = 2;
        bot.sendMessage(chatId, '✅ Текст сохранён.\n\n<b>Шаг 3/3:</b> Отправьте <b>фото</b> или напишите "пропустить":', {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 2) {
        if (text && text.toLowerCase() === 'пропустить') {
          state.image_url = null;
          state.step = 4;
        } else if (msg.photo && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          const fileLink = await bot.getFileLink(photo.file_id);
          state.image_url = fileLink.href;
          state.step = 4;
        } else {
          bot.sendMessage(chatId, '❌ Отправьте фото или напишите "пропустить":');
          return;
        }
      }
      if (state.step === 4) {
        try {
          db.prepare(`INSERT INTO news (title, content, image_url) VALUES (?, ?, ?)`).run(
            state.title, state.content, state.image_url
          );
          
          bot.sendMessage(chatId, `✅ <b>Новость добавлена!</b>

📰 ${escapeHtml(state.title)}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'back_admin' }]]
            }
          });
        } catch (e) {
          bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(e.message)}`);
        }
        delete adminState[chatId];
        return;
      }
    }

    // ===== СОЗДАНИЕ ПРОМОКОДА =====
    if (state.type === 'promocode') {
      if (state.step === 0) {
        const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length < 3) {
          bot.sendMessage(chatId, '❌ Код слишком короткий. Минимум 3 символа:');
          return;
        }
        state.code = code;
        state.step = 1;
        bot.sendMessage(chatId, `✅ Код <code>${code}</code> сохранён.\n\n<b>Шаг 2/3:</b> Размер <b>скидки</b> в процентах (1-100):`, {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 1) {
        const discount = parseInt(text);
        if (isNaN(discount) || discount < 1 || discount > 100) {
          bot.sendMessage(chatId, '❌ Неверный процент. Отправьте число от 1 до 100:');
          return;
        }
        state.discount = discount;
        state.step = 2;
        bot.sendMessage(chatId, `✅ Скидка ${discount}% сохранена.\n\n<b>Шаг 3/3:</b> Макс. <b>кол-во использований</b> (0 = безлимит):`, {
          parse_mode: 'HTML'
        });
        return;
      }
      if (state.step === 2) {
        const maxUses = parseInt(text);
        if (isNaN(maxUses)) {
          bot.sendMessage(chatId, '❌ Отправьте число (0 для безлимита):');
          return;
        }
        state.max_uses = maxUses === 0 ? null : maxUses;
        state.step = 4;
      }
      if (state.step === 4) {
        try {
          db.prepare(`INSERT INTO promocodes (code, discount, max_uses) VALUES (?, ?, ?)`).run(
            state.code, state.discount, state.max_uses
          );
          
          bot.sendMessage(chatId, `✅ <b>Промокод создан!</b>

🎁 <code>${state.code}</code>
💰 Скидка: ${state.discount}%
${state.max_uses ? `🔢 Лимит: ${state.max_uses} раз` : '🔢 Безлимитный'}`, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🔙 В меню', callback_data: 'back_admin' }]]
            }
          });
        } catch (e) {
          if (e.message.includes('UNIQUE')) {
            bot.sendMessage(chatId, '❌ Такой промокод уже существует! Придумайте другой:');
            state.step = 0;
            return;
          }
          bot.sendMessage(chatId, `❌ Ошибка: ${escapeHtml(e.message)}`);
        }
        delete adminState[chatId];
        return;
      }
    }
  });

  // === API ===

  app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
  });

  app.get('/api/products', (req, res) => {
    const categoryId = req.query.category_id;
    const products = categoryId 
      ? db.prepare('SELECT * FROM products WHERE category_id = ? AND is_active = 1 ORDER BY created_at DESC').all(categoryId)
      : db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1 ORDER BY p.created_at DESC').all();
    res.json(products);
  });

  app.get('/api/news', (req, res) => {
    const news = db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 20').all();
    res.json(news);
  });

  app.post('/api/validate-promocode', (req, res) => {
    const { code } = req.body;
    const promocode = db.prepare('SELECT * FROM promocodes WHERE code = ? AND is_active = 1').get(code?.toUpperCase());
    
    if (!promocode) {
      return res.json({ valid: false, error: 'Промокод не найден' });
    }
    
    if (promocode.max_uses && promocode.uses_count >= promocode.max_uses) {
      return res.json({ valid: false, error: 'Промокод исчерпан' });
    }
    
    res.json({ valid: true, discount: promocode.discount });
  });

  app.post('/api/orders', (req, res) => {
    const { userId, items, totalAmount, deliveryAddress, contactInfo, comment, promocode } = req.body;
    
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    if (!user) {
      db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(userId);
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    }
    
    const orderUuid = uuidv4();
    const result = db.prepare(`
      INSERT INTO orders (order_uuid, user_id, total_amount, delivery_address, contact_info, comment, promocode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderUuid, user.id, totalAmount, deliveryAddress, contactInfo, comment, promocode || null);
    
    if (promocode) {
      db.prepare('UPDATE promocodes SET uses_count = uses_count + 1 WHERE code = ?').run(promocode.toUpperCase());
    }
    
    const orderId = result.lastInsertRowid;
    const itemStmt = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)');
    items.forEach(item => itemStmt.run(orderId, item.product_id, item.name, item.quantity, item.price));
    
    adminIds.forEach(adminId => {
      const itemsText = items.map(i => `• ${escapeHtml(i.name)} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(adminId, `🔔 <b>Новый заказ!</b>

📦 #${orderUuid.substring(0, 8)}
👤 ${userId}
💰 ${formatPrice(totalAmount)}
📍 ${deliveryAddress || '—'}
📞 ${contactInfo || '—'}
${promocode ? `🎁 Промокод: ${promocode}` : ''}

🛒 ${itemsText}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.orderStatusKeyboard(orderId, 'pending')
      });
    });
    
    bot.sendMessage(userId, `✅ <b>Заказ #${orderUuid.substring(0, 8)} принят!</b>`, {
      parse_mode: 'HTML'
    });
    
    res.json({ success: true, orderId: orderUuid });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
    console.log(`📱 Mini App: ${WEB_APP_URL}`);
  });

  console.log('🤖 Бот запущен');
  console.log(`👥 Админы: ${adminIds.join(', ') || '—'}`);
  console.log(`📢 Канал: ${CHANNEL_ID}`);
}

start().catch(console.error);

module.exports = app;
