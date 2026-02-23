// Главные клавиатуры
const mainKeyboard = {
  keyboard: [
    ['🛒 Каталог', '📦 Мои заказы'],
    ['👤 Профиль', '📞 Поддержка']
  ],
  resize_keyboard: true
};

// Админ клавиатура
const adminKeyboard = {
  keyboard: [
    ['📊 Статистика', '📦 Заказы'],
    ['🛍️ Товары', '👥 Пользователи'],
    ['🔙 В меню']
  ],
  resize_keyboard: true
};

// Клавиатура категорий
const categoriesKeyboard = (categories) => {
  const buttons = categories.map(cat => [cat.name]);
  buttons.push(['🔙 Назад']);
  return { keyboard: buttons, resize_keyboard: true };
};

// Inline клавиатура для товара
const productInlineKeyboard = (productId) => ({
  inline_keyboard: [
    [{ text: '➕ Добавить', callback_data: `add_${productId}` }],
    [{ text: '🔙 Назад', callback_data: 'back_to_category' }]
  ]
});

// Inline клавиатура для корзины
const cartInlineKeyboard = {
  inline_keyboard: [
    [{ text: '📝 Оформить заказ', callback_data: 'checkout' }],
    [{ text: '🧹 Очистить', callback_data: 'clear_cart' }],
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
    buttons.push([{ text: '🚀 В доставке', callback_data: `shipping_${orderId}` }]);
  }
  
  if (status === 'shipping') {
    buttons.push([{ text: '✅ Завершен', callback_data: `complete_${orderId}` }]);
  }
  
  buttons.push([{ text: '🔙 Назад', callback_data: 'orders_back' }]);
  
  return { inline_keyboard: buttons };
};

module.exports = {
  mainKeyboard,
  adminKeyboard,
  categoriesKeyboard,
  productInlineKeyboard,
  cartInlineKeyboard,
  orderStatusKeyboard
};
