// Главная клавиатура
const mainKeyboard = {
  keyboard: [
    ['🛒 Каталог', '📦 Мои заказы'],
    ['👤 Профиль', '📞 Поддержка']
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

// Админ клавиатура
const adminKeyboard = {
  keyboard: [
    ['📊 Статистика', '📦 Заказы'],
    ['🛍️ Товары', '👥 Пользователи'],
    ['🔙 В меню']
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

// Клавиатура категорий
const categoriesKeyboard = (categories) => {
  const buttons = categories.map(cat => [cat.name]);
  buttons.push(['🔙 Назад']);
  return { 
    keyboard: buttons, 
    resize_keyboard: true,
    one_time_keyboard: true
  };
};

// Inline клавиатура для товара
const productInlineKeyboard = (productId) => ({
  inline_keyboard: [
    [{ text: '➕ В корзину', callback_data: `add_${productId}` }],
    [{ text: '🔙 Назад', callback_data: 'back_to_category' }]
  ]
});

// Inline клавиатура для корзины
const cartInlineKeyboard = {
  inline_keyboard: [
    [{ text: '📝 Оформить заказ', callback_data: 'checkout' }],
    [{ text: '🧹 Очистить корзину', callback_data: 'clear_cart' }],
    [{ text: '🔙 Продолжить покупки', callback_data: 'continue_shopping' }]
  ]
};

// Inline клавиатура для статуса заказа
const orderStatusKeyboard = (orderId, status) => {
  const buttons = [];
  
  if (status === 'pending') {
    buttons.push([
      { text: '✅ Подтвердить', callback_data: `confirm_${orderId}` },
      { text: '❌ Отменить', callback_data: `cancel_${orderId}` }
    ]);
  }
  
  if (status === 'confirmed') {
    buttons.push([{ text: '🚀 В доставку', callback_data: `shipping_${orderId}` }]);
  }
  
  if (status === 'shipping') {
    buttons.push([{ text: '✅ Завершить', callback_data: `complete_${orderId}` }]);
  }
  
  if (status === 'completed' || status === 'cancelled') {
    buttons.push([{ text: 'ℹ️ Архив', callback_data: 'archive_order' }]);
  } else {
    buttons.push([{ text: '🔙 Назад', callback_data: 'orders_back' }]);
  }
  
  return { inline_keyboard: buttons };
};

// Клавиатура для товаров (админ)
const productsAdminKeyboard = {
  inline_keyboard: [
    [{ text: '➕ Добавить товар', callback_data: 'add_product' }],
    [{ text: '🔄 Обновить список', callback_data: 'refresh_products' }]
  ]
};

// Клавиатура для пользователей (админ)
const usersAdminKeyboard = {
  inline_keyboard: [
    [{ text: '🔄 Обновить список', callback_data: 'refresh_users' }]
  ]
};

module.exports = {
  mainKeyboard,
  adminKeyboard,
  categoriesKeyboard,
  productInlineKeyboard,
  cartInlineKeyboard,
  orderStatusKeyboard,
  productsAdminKeyboard,
  usersAdminKeyboard
};
