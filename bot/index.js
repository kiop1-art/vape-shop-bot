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

let bot;
let app;
let WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3001';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

async function start() {
  await db.initDatabase();
  console.log('✅ База данных инициализирована');
  
  bot = new TelegramBot(token, { polling: true });
  app = express();
  
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../webapp')));
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
  
  function registerUser(userId, username, firstName, lastName) {
    try {
      db.prepare(`INSERT OR IGNORE INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)`).run(
        userId || 0, username || null, firstName || null, lastName || null
      );
      db.prepare(`UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE telegram_id = ?`).run(
        username || null, firstName || null, lastName || null, userId || 0
      );
    } catch (e) { console.error('Ошибка регистрации:', e); }
  }

  function isAdmin(userId) { return adminIds.includes(userId); }
  function formatPrice(price) { return `${price.toLocaleString('ru-RU')} ₽`; }
  function getStatusEmoji(status) {
    const emojis = { pending: '⏳', confirmed: '✅', shipping: '🚀', completed: '✨', cancelled: '❌' };
    return emojis[status] || '📦';
  }

  // Состояние для добавления товара
  const productState = {};

  // === КОМАНДЫ БОТА ===

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    
    bot.sendMessage(chatId, `👋 Привет, ${msg.from.first_name}!

🛍️ **VapeShop** — твой магазин

📱 Нажми кнопку ниже:`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🛒 Открыть каталог', web_app: { url: WEB_APP_URL } }]]
      },
      parse_mode: 'Markdown'
    });
    
    if (isAdmin(chatId)) {
      setTimeout(() => {
        bot.sendMessage(chatId, '🔑 **Админ-панель**', {
          reply_markup: keyboards.adminKeyboard,
          parse_mode: 'Markdown'
        });
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
      reply_markup: keyboards.categoriesKeyboard(categories),
      parse_mode: 'Markdown'
    });
  });

  bot.onText(/👤 Профиль/, (msg) => {
    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(msg.chat.id);
    if (!user) return;
    const ordersCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(user.id).count;
    const totalSpent = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != \'cancelled\'').get(user.id).total;
    
    bot.sendMessage(msg.chat.id, `👤 **Профиль**

📛 ${user.first_name} ${user.last_name || ''}
🆔 \`${user.telegram_id}\`
📅 ${new Date(user.created_at).toLocaleDateString('ru-RU')}

📦 Заказов: ${ordersCount}
💰 Потрачено: ${formatPrice(totalSpent)}`, {
      parse_mode: 'Markdown'
    });
  });

  bot.onText(/📞 Поддержка/, (msg) => {
    bot.sendMessage(msg.chat.id, `📞 **Поддержка**

💬 @vapeshop_support
⏰ 10:00 - 22:00 МСК`, {
      parse_mode: 'Markdown'
    });
  });

  // === АДМИН ПАНЕЛЬ ===

  bot.onText(/📊 Статистика/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const revenue = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != \'cancelled\'').get().total;
    
    bot.sendMessage(msg.chat.id, `📊 **Статистика**

👥 ${totalUsers}
🛍️ ${totalProducts}
📦 ${totalOrders}
💰 ${formatPrice(revenue)}`, {
      parse_mode: 'Markdown'
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
      const itemsText = items.map(i => `• ${i.product_name} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(msg.chat.id, `📦 #${order.order_uuid.substring(0, 8)}

👤 ${order.first_name} (\`${order.telegram_id}\`)
💰 ${formatPrice(order.total_amount)}
📊 ${getStatusEmoji(order.status)} ${order.status}

🛒 ${itemsText}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.orderStatusKeyboard(order.id, order.status)
      });
    });
  });

  bot.onText(/🛍️ Товары/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🛍️ **Управление товарами**\n\nВыберите действие:', {
      reply_markup: keyboards.productsAdminKeyboard,
      parse_mode: 'Markdown'
    });
  });

  bot.onText(/➕ Добавить товар/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    productState[msg.chat.id] = { step: 0 };
    bot.sendMessage(msg.chat.id, '📝 **Добавление товара**\n\nОтправьте название товара:', {
      parse_mode: 'Markdown',
      reply_markup: { keyboard: [['❌ Отмена']], resize_keyboard: true }
    });
  });

  bot.onText(/❌ Отмена/, (msg) => {
    delete productState[msg.chat.id];
    bot.sendMessage(msg.chat.id, '❌ Отменено', {
      reply_markup: keyboards.adminKeyboard
    });
  });

  // Обработка состояния добавления товара
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId) || !productState[chatId]) return;
    if (msg.text && msg.text === '❌ Отмена') return;

    const state = productState[chatId];

    // Шаг 1: Название
    if (state.step === 0) {
      state.name = msg.text;
      state.step = 1;
      bot.sendMessage(chatId, '📝 Отправьте описание:');
      return;
    }

    // Шаг 2: Описание
    if (state.step === 1) {
      state.description = msg.text;
      state.step = 2;
      bot.sendMessage(chatId, '💰 Отправьте цену (число в рублях):');
      return;
    }

    // Шаг 3: Цена
    if (state.step === 2) {
      const price = parseInt(msg.text);
      if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, '❌ Неверная цена. Отправьте число:');
        return;
      }
      state.price = price;
      state.step = 3;
      bot.sendMessage(chatId, '📂 Отправьте ID категории (1-4):\n\n1 — 💧 Жидкости\n2 — 🔥 Поды\n3 — 🔧 Расходники\n4 — 🎁 Наборы');
      return;
    }

    // Шаг 4: Категория
    if (state.step === 3) {
      const categoryId = parseInt(msg.text);
      if (![1, 2, 3, 4].includes(categoryId)) {
        bot.sendMessage(chatId, '❌ Неверный ID. Отправьте 1-4:');
        return;
      }
      state.category_id = categoryId;
      state.step = 4;
      bot.sendMessage(chatId, '📸 Отправьте фото товара (или напишите "пропустить"):');
      return;
    }

    // Шаг 5: Фото
    if (state.step === 4) {
      let imageUrl = null;
      
      if (msg.text && msg.text.toLowerCase() === 'пропустить') {
        state.step = 6;
      } else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const fileLink = await bot.getFileLink(photo.file_id);
        imageUrl = fileLink.href;
        state.image_url = imageUrl;
        state.step = 6;
      } else {
        bot.sendMessage(chatId, '❌ Отправьте фото или напишите "пропустить":');
        return;
      }
    }

    // Шаг 6: Сохранение
    if (state.step === 6) {
      const result = db.prepare(`
        INSERT INTO products (category_id, name, description, price, image_url, stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(state.category_id, state.name, state.description, state.price, state.image_url, 100);

      const categories = db.prepare('SELECT name FROM categories WHERE id = ?').get(state.category_id);
      
      bot.sendMessage(chatId, `✅ **Товар добавлен!**

📦 ${state.name}
💰 ${formatPrice(state.price)}
📂 ${categories?.name || '—'}

🔁 Добавить ещё один?`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Да', callback_data: 'add_another_product' }],
            [{ text: '🔙 В меню', callback_data: 'admin_menu' }]
          ]
        }
      });

      delete productState[chatId];
    }
  });

  bot.onText(/👥 Пользователи/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    const users = db.prepare(`
      SELECT u.*, COUNT(o.id) as order_count, COALESCE(SUM(o.total_amount), 0) as total_spent
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 20
    `).all();
    
    if (users.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Пользователей нет');
      return;
    }
    
    let message = '👥 **Пользователи**\n\n';
    users.forEach((u, i) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Без имени';
      message += `${i + 1}. **${name}** (\`${u.telegram_id}\`)\n`;
      message += `   📦 ${u.order_count} заказов | 💰 ${formatPrice(u.total_spent)}\n\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'refresh_users' }]] }
    });
  });

  bot.onText(/🔙 В меню/, (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, '🔑 **Админ-панель**', {
      reply_markup: keyboards.adminKeyboard,
      parse_mode: 'Markdown'
    });
  });

  bot.onText(/🔙 Назад/, (msg) => {
    bot.sendMessage(msg.chat.id, '📂 **Меню**', {
      reply_markup: keyboards.mainKeyboard,
      parse_mode: 'Markdown'
    });
  });

  // === CALLBACK QUERY ===

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    if (data.startsWith('confirm_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('confirmed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✅ Подтверждено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✅ Заказ #${order.order_uuid.substring(0, 8)} подтвержден!`);
        bot.editMessageReplyMarkup({ inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'confirmed').inline_keyboard }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('cancel_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);
      bot.answerCallbackQuery(query.id, { text: '❌ Отменено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `❌ Заказ #${order.order_uuid.substring(0, 8)} отменен`);
        bot.editMessageReplyMarkup({ inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'cancelled').inline_keyboard }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('shipping_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('shipping', orderId);
      bot.answerCallbackQuery(query.id, { text: '🚀 В доставке' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `🚀 Заказ #${order.order_uuid.substring(0, 8)} в доставке!`);
        bot.editMessageReplyMarkup({ inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'shipping').inline_keyboard }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data.startsWith('complete_')) {
      if (!isAdmin(chatId)) return;
      const orderId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('completed', orderId);
      bot.answerCallbackQuery(query.id, { text: '✨ Завершено' });
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (order) {
        bot.sendMessage(order.user_id, `✨ Заказ #${order.order_uuid.substring(0, 8)} завершен!`);
        bot.editMessageReplyMarkup({ inline_keyboard: keyboards.orderStatusKeyboard(orderId, 'completed').inline_keyboard }, { chat_id: chatId, message_id: messageId });
      }
      return;
    }

    if (data === 'orders_back' || data === 'admin_menu') {
      bot.deleteMessage(chatId, messageId);
      return;
    }

    if (data === 'add_another_product') {
      bot.deleteMessage(chatId, messageId);
      bot.emit('text', { chat: { id: chatId }, text: '➕ Добавить товар' });
      return;
    }

    if (data === 'refresh_users') {
      bot.answerCallbackQuery(query.id, { text: '🔄 Обновлено' });
      bot.deleteMessage(chatId, messageId);
      bot.emit('text', { chat: { id: chatId }, text: '👥 Пользователи' });
      return;
    }
  });

  // === API ДЛЯ MINI APP ===

  app.get('/api/categories', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
  });

  app.get('/api/products', (req, res) => {
    const categoryId = req.query.category_id;
    const products = categoryId 
      ? db.prepare('SELECT * FROM products WHERE category_id = ? AND is_active = 1 ORDER BY created_at DESC').all(categoryId)
      : db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.is_active = 1 ORDER BY p.created_at DESC').all();
    
    // Добавляем URL для изображений
    const productsWithImages = products.map(p => ({
      ...p,
      image_url: p.image_url || `/uploads/placeholder.png`
    }));
    
    res.json(productsWithImages);
  });

  // Загрузка изображений через API
  app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
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
      const itemsText = items.map(i => `• ${i.name} x${i.quantity} — ${formatPrice(i.price * i.quantity)}`).join('\n');
      bot.sendMessage(adminId, `🔔 **Новый заказ!**

📦 #${orderUuid.substring(0, 8)}
👤 ${userId}
💰 ${formatPrice(totalAmount)}
📍 ${deliveryAddress || '—'}
📞 ${contactInfo || '—'}

🛒 ${itemsText}${comment ? `\n💬 ${comment}` : ''}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.orderStatusKeyboard(orderId, 'pending')
      });
    });
    
    bot.sendMessage(userId, `✅ **Заказ #${orderUuid.substring(0, 8)} принят!**`, {
      parse_mode: 'Markdown'
    });
    
    res.json({ success: true, orderId: orderUuid });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Сервер на порту ${PORT}`);
    console.log(`📱 Mini App: ${WEB_APP_URL}`);
  });

  console.log('🤖 Бот запущен');
  console.log(`👥 Админы: ${adminIds.join(', ') || '—'}`);
}

start().catch(console.error);

module.exports = app;
