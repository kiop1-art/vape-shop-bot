require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const path = require('path');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');
const keyboards = require('./keyboards');

const token = process.env.BOT_TOKEN;
const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const PORT = process.env.PORT || 3001;

let bot;
let app;
let WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3001';

async function start() {
  await db.initDatabase();
  console.log('✅ База данных инициализирована');
  
  bot = new TelegramBot(token, { polling: true });
  app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../webapp')));

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
  
  function registerUser(userId, username, firstName, lastName) {
    try {
      db.prepare(`INSERT OR IGNORE INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)`).run(userId, username, firstName, lastName);
      db.prepare(`UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?`).run(username, firstName, lastName, userId);
    } catch (e) { console.error('Ошибка регистрации:', e); }
  }

  function isAdmin(userId) { return adminIds.includes(userId); }
  function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }
  function getStatusEmoji(status) {
    const emojis = { pending: '⏳', confirmed: '✅', shipping: '🚀', completed: '✨', cancelled: '❌' };
    return emojis[status] || '📦';
  }

  // === КОМАНДЫ БОТА ===

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    bot.sendMessage(chatId, `👋 Привет, ${msg.from.first_name}!

🛍️ **VapeShop** - магазин жидкостей, подов и расходников!

📱 Нажми кнопку ниже, чтобы открыть каталог:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: WEB_APP_URL } }]]
      },
      parse_mode: 'Markdown'
    });
    
    if (isAdmin(chatId)) {
      setTimeout(() => {
        bot.sendMessage(chatId, '🔑 **Панель администратора**\n\nВыберите действие:', {
          reply_markup: keyboards.adminKeyboard,
          parse_mode: 'Markdown'
        });
      }, 500);
    }
  });

  // Каталог
  bot.onText(/🛒 Каталог/, (msg) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    if (categories.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Каталог пока пуст');
      return;
    }
    bot.sendMessage(msg.chat.id, '📂 **Выберите категорию:**', {
      reply_markup: keyboards.categoriesKeyboard(categories),
      parse_mode: 'Markdown'
    });
  });

  // Профиль
  bot.onText(/👤 Профиль/, (msg) => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(msg.chat.id);
    if (!user) {
      bot.sendMessage(msg.chat.id, '📭 Профиль не найден. Отправьте /start');
      return;
    }
    const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(user.id).count;
    const totalSpent = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != \'cancelled\'').get(user.id).total;
    
    bot.sendMessage(msg.chat.id, `👤 **Ваш профиль**

📛 **Имя:** ${user.first_name} ${user.last_name || ''}
🆔 **ID:** \`${user.telegram_id}\`
📅 **Регистрация:** ${new Date(user.created_at).toLocaleDateString('ru-RU')}

📦 **Заказов:** ${ordersCount}
💰 **Потрачено:** ${formatPrice(totalSpent)}`, {
      parse_mode: 'Markdown'
    });
  });

  // Поддержка
  bot.onText(/📞 Поддержка/, (msg) => {
    bot.sendMessage(msg.chat.id, `📞 **Поддержка**

💬 Telegram: @vapeshop_support
📧 Email: support@vapeshop.ru

⏰ **Режим работы:** 10:00 - 22:00 (МСК)`, {
      parse_mode: 'Markdown'
    });
  });

  // === АДМИН ПАНЕЛЬ ===

  // Статистика
  bot.onText(/📊 Статистика/, (msg) => {
    if (!isAdmin(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, '❌ Доступ запрещён');
      return;
    }
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const pendingOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE status = \'pending\'').get().count;
    const revenue = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != \'cancelled\'').get().total;
    
    bot.sendMessage(msg.chat.id, `📊 **Статистика магазина**

👥 Пользователей: \`${totalUsers}\`
🛍️ Товаров: \`${totalProducts}\`
📦 Всего заказов: \`${totalOrders}\`
⏳ В ожидании: \`${pendingOrders}\`
💰 Выручка: \`${formatPrice(revenue)}\``, {
      parse_mode: 'Markdown'
    });
  });

  // Заказы
  bot.onText(/📦 Заказы/, (msg) => {
    if (!isAdmin(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, '❌ Доступ запрещён');
      return;
    }
    const orders = db.prepare(`
      SELECT o.*, u.first_name, u.last_name, u.telegram_id
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
      LIMIT 10
    `).all();
    
    if (orders.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Заказов пока нет');
      return;
    }
    
    orders.forEach(order => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      const itemsText = items.map(i => `• ${i.product_name} x${i.quantity} - ${formatPrice(i.price * i.quantity)}`).join('\n');
      
      bot.sendMessage(msg.chat.id, `📦 **Заказ #${order.order_uuid.substring(0, 8)}**

👤 Заказчик: ${order.first_name} (\`${order.telegram_id}\`)
💰 Сумма: ${formatPrice(order.total_amount)}
📊 Статус: ${getStatusEmoji(order.status)} ${order.status}
📍 Адрес: ${order.delivery_address || 'Не указан'}
📞 Контакты: ${order.contact_info || 'Не указаны'}

🛒 **Товары:**
${itemsText}

🕐 Создан: ${new Date(order.created_at).toLocaleString('ru-RU')}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.orderStatusKeyboard(order.id, order.status)
      });
    });
  });

  // Товары (админ)
  bot.onText(/🛍️ Товары/, (msg) => {
    if (!isAdmin(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, '❌ Доступ запрещён');
      return;
    }
    
    const products = db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `).all();
    
    if (products.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Товаров пока нет');
      return;
    }
    
    let message = '🛍️ **Товары**\n\n';
    products.forEach((p, i) => {
      message += `${i + 1}. **${p.name}** - ${formatPrice(p.price)}\n`;
      message += `   Категория: ${p.category_name || '—'}\n`;
      message += `   Остаток: ${p.stock} шт.\n\n`;
    });
    
    message += '\n💡 _Для управления товарами используйте базу данных_';
    
    bot.sendMessage(msg.chat.id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '➕ Добавить товар', callback_data: 'add_product' },
          { text: '🔄 Обновить', callback_data: 'refresh_products' }
        ]]
      }
    });
  });

  // Пользователи (админ)
  bot.onText(/👥 Пользователи/, (msg) => {
    if (!isAdmin(msg.chat.id)) {
      bot.sendMessage(msg.chat.id, '❌ Доступ запрещён');
      return;
    }
    
    const users = db.prepare(`
      SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 20
    `).all();
    
    if (users.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Пользователей пока нет');
      return;
    }
    
    let message = '👥 **Пользователи**\n\n';
    users.forEach((u, i) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
      const username = u.username ? `@${u.username}` : '—';
      message += `${i + 1}. **${name}**\n`;
      message += `   Username: ${username}\n`;
      message += `   ID: \`${u.telegram_id}\`\n`;
      message += `   Заказов: ${u.order_count} | Потрачено: ${formatPrice(u.total_spent)}\n`;
      message += `   В боте с: ${new Date(u.created_at).toLocaleDateString('ru-RU')}\n\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 Обновить', callback_data: 'refresh_users' }
        ]]
      }
    });
  });

  // Назад в меню
  bot.onText(/🔙 В меню/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🔑 **Панель администратора**\n\nВыберите действие:', {
      reply_markup: keyboards.adminKeyboard,
      parse_mode: 'Markdown'
    });
  });

  // Назад (для категорий)
  bot.onText(/🔙 Назад/, (msg) => {
    bot.sendMessage(msg.chat.id, '📂 **Главное меню**', {
      reply_markup: keyboards.mainKeyboard,
      parse_mode: 'Markdown'
    });
  });

  // === CALLBACK QUERY ===

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    // Управление заказами (админ)
    if (data.startsWith('confirm_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Подтверждено', show_alert: true });
      
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✅ Ваш заказ #${order.order_uuid.substring(0, 8)} подтвержден!`);
        bot.editMessageReplyMarkup({
          inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'confirmed').inline_keyboard
        }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('cancel_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено', show_alert: true });
      
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `❌ Ваш заказ #${order.order_uuid.substring(0, 8)} отменен`);
        bot.editMessageReplyMarkup({
          inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'cancelled').inline_keyboard
        }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('shipping_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('shipping', orderId);
      bot.answerCallbackQuery(query.id, { text: '🚀 В доставке', show_alert: true });
      
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `🚀 Ваш заказ #${order.order_uuid.substring(0, 8)} передан в доставку!`);
        bot.editMessageReplyMarkup({
          inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'shipping').inline_keyboard
        }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('complete_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✨ Завершено', show_alert: true });
      
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✨ Ваш заказ #${order.order_uuid.substring(0, 8)} завершен. Спасибо!`);
        bot.editMessageReplyMarkup({
          inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'completed').inline_keyboard
        }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data === 'orders_back') {
      bot.deleteMessage(chatId, messageId);
      return;
    }

    if (data === 'refresh_products') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId);
      bot.sendMessage(chatId, '🛍️ **Товары**\n\n_Обновите список_', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '➕ Добавить товар', callback_data: 'add_product' },
            { text: '🔄 Обновить', callback_data: 'refresh_products' }
          ]]
        }
      });
      return;
    }

    if (data === 'refresh_users') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId);
      // Перезапускаем команду пользователей
      bot.emit('text', { chat: { id: chatId }, text: '👥 Пользователи' });
      return;
    }

    if (data === 'add_product') {
      bot.answerCallbackQuery(query.id, { 
        text: 'ℹ️ Товары добавляются через базу данных', 
        show_alert: true 
      });
      return;
    }
  });

  // === API ДЛЯ MINI APP ===

  app.get('/api/categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    res.json(categories);
  });

  app.get('/api/products', (req, res) => {
    const categoryId = req.query.category_id;
    let products;
    
    if (categoryId) {
      products = db.prepare(`
        SELECT * FROM products 
        WHERE category_id = ? AND is_active = 1 
        ORDER BY created_at DESC
      `).all(categoryId);
    } else {
      products = db.prepare(`
        SELECT p.*, c.name as category_name 
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1 
        ORDER BY p.created_at DESC
      `).all();
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
    
    // Уведомление админам
    adminIds.forEach(adminId => {
      const itemsText = items.map(i => `• ${i.name} x${i.quantity} - ${formatPrice(i.price * i.quantity)}`).join('\n');
      
      bot.sendMessage(adminId, `🔔 **Новый заказ!**

📦 Заказ #${orderUuid.substring(0, 8)}
👤 ID: \`${userId}\`
💰 Сумма: ${formatPrice(totalAmount)}
📍 Адрес: ${deliveryAddress || 'Не указан'}
📞 Контакты: ${contactInfo || 'Не указаны'}

🛒 **Товары:**
${itemsText}${comment ? `\n💬 Комментарий: ${comment}` : ''}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.orderStatusKeyboard(orderId, 'pending')
      });
    });
    
    // Уведомление пользователю
    bot.sendMessage(userId, `✅ **Ваш заказ #${orderUuid.substring(0, 8)} принят!**

Мы уведомим вас об изменениях статуса.`, {
      parse_mode: 'Markdown'
    });
    
    res.json({ success: true, orderId: orderUuid });
  });

  // Запуск сервера
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Mini App URL: ${WEB_APP_URL}`);
  });

  console.log('🤖 Бот запущен и готов к работе!');
  console.log(`👥 Администраторы: ${adminIds.join(', ') || 'Не настроены'}`);
}

start().catch(console.error);

// Экспорт для Vercel/Railway
module.exports = app;
