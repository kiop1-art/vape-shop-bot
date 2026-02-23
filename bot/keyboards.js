// Главная клавиатура
const mainKeyboard = {
  keyboard: [
    ['🛒 Каталог', '📰 Новости'],
    ['📦 Мои заказы', '👤 Профиль'],
    ['📞 Поддержка']
  ],
  resize_keyboard: true
};

// Админ клавиатура
const adminKeyboard = {
  keyboard: [
    ['📊 Статистика', '📦 Заказы'],
    ['🛍️ Товары', '👥 Пользователи'],
    ['📰 Новости', '🎁 Промокоды'],
    ['🔙 В меню']
  ],
  resize_keyboard: true
};

// Админ товары
const productsAdminKeyboard = {
  inline_keyboard: [
    [{ text: '➕ Добавить товар', callback_data: 'add_product' }],
    [{ text: '📦 Список товаров', callback_data: 'list_products' }],
    [{ text: '🔙 В меню', callback_data: 'back_admin' }]
  ]
};

// Категории
const categoriesKeyboard = (categories) => {
  const buttons = categories.map(cat => [cat.name]);
  buttons.push(['🔙 Назад']);
  return { keyboard: buttons, resize_keyboard: true, one_time_keyboard: true };
};

// Статус заказа
const orderStatusKeyboard = (orderId, status) => {
  const buttons = [];
  
  if (status === 'pending') {
    buttons.push([
      { text: '✅ Подтвердить', callback_data: `confirm_${orderId}` },
      { text: '❌ Отменить', callback_data: `cancel_${orderId}` }
    ]);
  } else if (status === 'confirmed') {
    buttons.push([{ text: '🚀 В доставку', callback_data: `shipping_${orderId}` }]);
  } else if (status === 'shipping') {
    buttons.push([{ text: '✅ Завершить', callback_data: `complete_${orderId}` }]);
  }
  
  return { inline_keyboard: buttons };
};

module.exports = {
  mainKeyboard,
  adminKeyboard,
  productsAdminKeyboard,
  categoriesKeyboard,
  orderStatusKeyboard
};
