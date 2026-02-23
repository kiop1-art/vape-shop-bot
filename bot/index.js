require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const keyboards = require('./keyboards');

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3001';
const PORT = process.env.PORT || 3001;

// === ИНИЦИАЛИЗАЦИЯ ===

async function start() {
  await db.initDatabase();
  console.log('✅ База данных инициализирована');
  
  const bot = new TelegramBot(token, { polling: true });
  const app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../webapp')));

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

  function registerUser(userId, username, firstName, lastName) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO users (telegram_id, username, first_name, last_name)
        VALUES (?, ?, ?, ?)
      `).run(userId, username, firstName, lastName);
      
      db.prepare(`
        UPDATE users SET username = ?, first_name = ?, last_name = ?
        WHERE telegram_id = ?
      `).run(username, firstName, lastName, userId);
    } catch (e) {
      console.error('Ошибка регистрации:', e);
    }
  }

  function isAdmin(userId) {
    return adminIds.includes(userId);
  }

  function formatPrice(price) {
    return `${price.toLocaleString('ru-RU')} ₽`;
  }

  function getStatusEmoji(status) {
    const emojis = {
      pending: '⏳', confirmed: '✅', shipping: '🚀', completed: '✨', cancelled: '❌'
    };
    return emojis[status] || '📦';
  }

  // === БОТ ===

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    bot.sendMessage(chatId, `👋 Привет, ${msg.from.first_name}!

🛍️ VapeShop - магазин жидкостей, подов и расходников!

📱 Нажми кнопку ниже:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: webAppUrl } }]]
      }
    });
    
    if (isAdmin(chatId)) {
      setTimeout(() => {
        bot.sendMessage(chatId, '🔑 Вы админ!', { reply_markup: keyboards.adminKeyboard });
      }, 500);
    }
  });

  bot.onText(/🛒 Каталог/, (msg) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    if (categories.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Каталог пуст');
      return;
    }
    bot.sendMessage(msg.chat.id, '📂 Выберите категорию:', {
      reply_markup: keyboards.categoriesKeyboard(categories)
    });
  });

  bot.onText(/👤 Профиль/, (msg) => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(msg.chat.id);
    if (!user) return;
    const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(user.id).count;
    const totalSpent = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != \'cancelled\'').get(user.id).total;
    bot.sendMessage(msg.chat.id, `👤 Профиль

📛 ${user.first_name} ${user.last_name || ''}
📅 ${new Date(user.created_at).toLocaleDateString('ru-RU')}
📦 Заказов: ${ordersCount}
💰 Потрачено: ${formatPrice(totalSpent)}`);
  });

  bot.onText(/📞 Поддержка/, (msg) => {
    bot.sendMessage(msg.chat.id, '📞 Поддержка: @vapeshop_support\n⏰ 10:00 - 22:00 МСК');
  });

  bot.onText(/📊 Статистика/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const revenue = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != \'cancelled\'').get().total;
    bot.sendMessage(msg.chat.id, `📊 Статистика

👥 ${totalUsers}
🛍️ ${totalProducts}
📦 ${totalOrders}
💰 ${formatPrice(revenue)}`);
  });

  bot.onText(/📦 Заказы/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const orders = db.prepare(`
      SELECT o.*, u.first_name, u.last_name, u.telegram_id
      FROM orders o JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all();
    if (orders.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Заказов нет');
      return;
    }
    orders.forEach(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const itemsText = items.map(i => `• ${i.product_name} x${i.quantity} - ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(msg.chat.id, `📦 #${order.order_uuid.substring(0, 8)}
👤 ${order.first_name} (${order.telegram_id})
💰 ${formatPrice(order.total_amount)}
📊 ${getStatusEmoji(order.status)} ${order.status}
🛒 ${itemsText}`, {
        reply_markup: keyboards.orderStatusKeyboard(order.id, order.status)
      });
    });
  });

  // === CALLBACK ===

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('confirm_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Подтверждено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) bot.sendMessage(order.user_id, `✅ Заказ #${order.order_uuid.substring(0, 8)} подтвержден!`);
    }

    if (data.startsWith('cancel_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) bot.sendMessage(order.user_id, `❌ Заказ #${order.order_uuid.substring(0, 8)} отменен`);
    }

    if (data.startsWith('shipping_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('shipping', orderId);
      bot.answerCallbackQuery(query.id, { text: '🚀 В доставке' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) bot.sendMessage(order.user_id, `🚀 Заказ #${order.order_uuid.substring(0, 8)} в доставке!`);
    }

    if (data.startsWith('complete_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✨ Завершен' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) bot.sendMessage(order.user_id, `✨ Заказ #${order.order_uuid.substring(0, 8)} завершен!`);
    }

    if (data === 'orders_back') {
      bot.deleteMessage(chatId, query.message.message_id);
    }
  });

  // === API ===

  app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
  });

  app.get('/api/products', (req, res) => {
    const categoryId = req.query.category_id;
    let products;
    if (categoryId) {
      products = db.prepare('SELECT * FROM products WHERE category_id = ? AND is_active = 1 ORDER BY created_at DESC').all(categoryId);
    } else {
      products = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1 ORDER BY p.created_at DESC').all();
    }
    res.json(products);
  });

  app.post('/api/orders', (req, res) => {
    const { userId, items, totalAmount, deliveryAddress, contactInfo, comment } = req.body;
    
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    if (!user) {
      db.prepare('INSERT INTO users (telegram_id) VALUES (?)').run(userId);
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId);
    }
    
    const orderUuid = uuidv4();
    const result = db.prepare(`
      INSERT INTO orders (order_uuid, user_id, total_amount, delivery_address, contact_info, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(orderUuid, user.id, totalAmount, deliveryAddress, contactInfo, comment);
    const orderId = result.lastInsertRowid;
    
    const itemStmt = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)');
    items.forEach(item => itemStmt.run(orderId, item.product_id, item.name, item.quantity, item.price));
    
    adminIds.forEach(adminId => {
      const itemsText = items.map(i => `• ${i.name} x${i.quantity} - ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(adminId, `🔔 Новый заказ!

📦 #${orderUuid.substring(0, 8)}
👤 ${userId}
💰 ${formatPrice(totalAmount)}
📍 ${deliveryAddress || 'Не указан'}
📞 ${contactInfo || 'Не указаны'}

🛒 ${itemsText}${comment ? `\n💬 ${comment}` : ''}`, {
        reply_markup: keyboards.orderStatusKeyboard(orderId, 'pending')
      });
    });
    
    bot.sendMessage(userId, `✅ Заказ #${orderUuid.substring(0, 8)} принят!`);
    res.json({ success: true, orderId: orderUuid });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
    console.log(`📱 Mini App: ${webAppUrl}`);
  });

  console.log('🤖 Бот запущен');
}

start().catch(console.error);
