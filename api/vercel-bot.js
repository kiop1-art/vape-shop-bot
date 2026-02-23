require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const db = require('../bot/database');
const { v4: uuidv4 } = require('uuid');
const keyboards = require('../bot/keyboards');

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const CHANNEL_ID = process.env.CHANNEL_ID || '@vapeshop_channel';

let bot = null;
let app = null;

// Инициализация бота БЕЗ polling (для Vercel webhooks)
function initBot() {
  if (bot) return bot;
  bot = new TelegramBot(token, { polling: false });
  return bot;
}

async function initDatabase() {
  await db.initDatabase();
  console.log('✅ База данных инициализирована');
}

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

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!')
    .replace(/&/g, '\\&');
}

function isAdmin(userId) { return adminIds.includes(userId); }
function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }
function getStatusEmoji(status) {
  const emojis = { pending: '⏳', confirmed: '✅', shipping: '🚀', completed: '✨', cancelled: '❌' };
  return emojis[status] || '📦';
}

async function checkSubscription(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_ID.replace('@', ''), userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

function setupBotHandlers() {
  if (!bot) return;

  // Обработка /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    const isSubscribed = await checkSubscription(chatId);
    if (!isSubscribed) {
      bot.sendMessage(chatId, `⚠️ **Для использования бота необходимо подписаться на наш канал!**

📢 Присоединяйтесь к ${CHANNEL_ID}

После подписки нажмите кнопку ниже:`, {
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Я подписался', callback_data: 'check_subscription' }]]
        },
        parse_mode: 'Markdown'
      });
      return;
    }

    bot.sendMessage(chatId, `👋 Привет, ${msg.from.first_name}!

🛍️ **VapeShop** — твой магазин

📱 Нажми кнопку ниже:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: process.env.WEB_APP_URL || 'https://your-domain.vercel.app' } }]]
      },
      parse_mode: 'Markdown'
    });

    if (isAdmin(chatId)) {
      setTimeout(() => {
        bot.sendMessage(chatId, '🔑 **Админ-панель**\n\nВыберите раздел:', {
          reply_markup: keyboards.adminKeyboard,
          parse_mode: 'Markdown'
        });
      }, 500);
    }
  });

  // Обработка callback query
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    if (data === 'check_subscription') {
      const isSubscribed = await checkSubscription(chatId);
      if (isSubscribed) {
        bot.deleteMessage(chatId, messageId);
        bot.sendMessage(chatId, `👋 Привет, ${query.from.first_name}!

🛍️ **VapeShop** — твой магазин

📱 Нажми кнопку ниже:`, {
          reply_markup: {
            inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: process.env.WEB_APP_URL || 'https://your-domain.vercel.app' } }]]
          },
          parse_mode: 'Markdown'
        });
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

    // Обработка статусов заказов
    const statusActions = {
      'confirm_': 'confirmed',
      'cancel_': 'cancelled',
      'shipping_': 'shipping',
      'complete_': 'completed'
    };

    for (const [prefix, status] of Object.entries(statusActions)) {
      if (data.startsWith(prefix)) {
        const orderId = parseInt(data.split('_')[1]);
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
        bot.answerCallbackQuery(query.id, { text: `✅ ${status === 'confirmed' ? 'Подтверждено' : status === 'cancelled' ? 'Отменено' : status === 'shipping' ? 'В доставке' : 'Завершено'}`, show_alert: true });
        
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (order) {
          bot.sendMessage(order.user_id, `${getStatusEmoji(status)} Заказ #${order.order_uuid.substring(0, 8)} ${status === 'confirmed' ? 'подтвержден' : status === 'cancelled' ? 'отменен' : status === 'shipping' ? 'в доставке' : 'завершен'}!`);
          try {
            bot.editMessageReplyMarkup({
              inline_keyboard: keyboards.orderStatusKeyboard(orderId, status).inline_keyboard
            }, { chat_id: chatId, message_id: messageId });
          } catch(e) {}
        }
        return;
      }
    }

    if (data === 'back_admin') {
      bot.deleteMessage(chatId, messageId).catch(() => {});
      bot.sendMessage(chatId, '🔑 **Админ-панель**\n\nВыберите раздел:', {
        reply_markup: keyboards.adminKeyboard,
        parse_mode: 'Markdown'
      });
      return;
    }
  });
}

// Express приложение для Vercel
app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../webapp')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Webhook endpoint для Telegram
app.post('/webhook', async (req, res) => {
  if (!bot) initBot();
  setupBotHandlers();
  
  try {
    bot.processUpdate(req.body);
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).send('Error');
  }
});

// GET запрос для проверки
app.get('/webhook', (req, res) => {
  res.status(200).send('Bot is running');
});

// API endpoints
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
    const itemsText = items.map(i => `• ${escapeMarkdown(i.name)} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
    bot.sendMessage(adminId, `🔔 **Новый заказ!**

📦 #${orderUuid.substring(0, 8)}
👤 \`${userId}\`
💰 ${formatPrice(totalAmount)}
📍 ${escapeMarkdown(deliveryAddress) || '—'}
📞 ${escapeMarkdown(contactInfo) || '—'}
${promocode ? `🎁 Промокод: ${escapeMarkdown(promocode)}` : ''}

🛒 ${itemsText}`, {
      parse_mode: 'Markdown',
      reply_markup: keyboards.orderStatusKeyboard(orderId, 'pending')
    });
  });

  bot.sendMessage(userId, `✅ **Заказ #${orderUuid.substring(0, 8)} принят!**`, {
    parse_mode: 'Markdown'
  });

  res.json({ success: true, orderId: orderUuid });
});

// Инициализация
initDatabase().then(() => {
  initBot();
  setupBotHandlers();
  console.log('🤖 Бот готов к работе с webhooks');
  console.log(`👥 Админы: ${adminIds.join(', ') || '—'}`);
  console.log(`📢 Канал: ${CHANNEL_ID}`);
}).catch(console.error);

module.exports = app;
