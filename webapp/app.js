// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Состояние приложения
let cart = [];
let products = [];
let categories = [];

// DOM элементы
const categoriesEl = document.getElementById('categories');
const productsGrid = document.getElementById('productsGrid');
const cartBtn = document.getElementById('cartBtn');
const cartCount = document.getElementById('cartCount');
const cartModal = document.getElementById('cartModal');
const cartItems = document.getElementById('cartItems');
const totalPrice = document.getElementById('totalPrice');
const checkoutBtn = document.getElementById('checkoutBtn');
const closeCart = document.getElementById('closeCart');
const checkoutModal = document.getElementById('checkoutModal');
const closeCheckout = document.getElementById('closeCheckout');
const checkoutForm = document.getElementById('checkoutForm');
const orderSummary = document.getElementById('orderSummary');
const totalAmount = document.getElementById('totalAmount');
const toast = document.getElementById('toast');
const loader = document.getElementById('loader');

// === ЗАГРУЗКА ДАННЫХ ===

async function loadCategories() {
  try {
    const response = await fetch('/api/categories');
    categories = await response.json();
    renderCategories();
  } catch (error) {
    console.error('Ошибка загрузки категорий:', error);
    // Демо-категории если API недоступно
    categories = [
      { id: 1, name: '💧 Жидкости', icon: '💧' },
      { id: 2, name: '🔥 Поды', icon: '🔥' },
      { id: 3, name: '🔧 Расходники', icon: '🔧' },
      { id: 4, name: '🎁 Наборы', icon: '🎁' }
    ];
    renderCategories();
  }
}

async function loadProducts(categoryId = null) {
  showLoader();
  try {
    const url = categoryId 
      ? `/api/products?category_id=${categoryId}` 
      : '/api/products';
    const response = await fetch(url);
    products = await response.json();
    renderProducts();
  } catch (error) {
    console.error('Ошибка загрузки товаров:', error);
    // Демо-товары если API недоступно
    products = getDemoProducts();
    renderProducts();
  }
  hideLoader();
}

function getDemoProducts() {
  return [
    {
      id: 1,
      category_id: 1,
      name: 'Husky Double Ice',
      description: 'Ледяной манго-маракуйя с двойной концентрацией',
      price: 450,
      image_url: '',
      stock: 50
    },
    {
      id: 2,
      category_id: 1,
      name: 'Brusko Berry',
      description: 'Смесь лесных ягод с прохладой',
      price: 390,
      image_url: '',
      stock: 30
    },
    {
      id: 3,
      category_id: 2,
      name: 'Vaporesso XROS 3',
      description: 'Компактный под-система с отличным вкусом',
      price: 2490,
      image_url: '',
      stock: 15
    },
    {
      id: 4,
      category_id: 2,
      name: 'Voopoo V.Thru',
      description: 'Стильный POD с керамическим испарителем',
      price: 1990,
      image_url: '',
      stock: 20
    },
    {
      id: 5,
      category_id: 3,
      name: 'Испарители XROS 0.6Ω',
      description: 'Комплект из 4 испарителей (упаковка)',
      price: 890,
      image_url: '',
      stock: 100
    },
    {
      id: 6,
      category_id: 3,
      name: 'Картриджи V.Thru',
      description: 'Комплект из 3 картриджей',
      price: 650,
      image_url: '',
      stock: 80
    },
    {
      id: 7,
      category_id: 4,
      name: 'Стартовый набор',
      description: 'Vaporesso XROS 3 + 2 жидкости в подарок',
      price: 2990,
      image_url: '',
      stock: 10
    },
    {
      id: 8,
      category_id: 1,
      name: 'SALTIC Lemon',
      description: 'Свежий лимон с мятой и льдом',
      price: 420,
      image_url: '',
      stock: 45
    }
  ];
}

// === РЕНДЕРИНГ ===

function renderCategories() {
  const allBtn = document.createElement('button');
  allBtn.className = 'category-btn active';
  allBtn.textContent = 'Все';
  allBtn.dataset.category = 'all';
  allBtn.addEventListener('click', () => selectCategory('all'));
  categoriesEl.innerHTML = '';
  categoriesEl.appendChild(allBtn);
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = cat.name;
    btn.dataset.category = cat.id;
    btn.addEventListener('click', () => selectCategory(cat.id));
    categoriesEl.appendChild(btn);
  });
}

function renderProducts() {
  if (products.length === 0) {
    productsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">В этой категории пока нет товаров</div>
      </div>
    `;
    return;
  }
  
  productsGrid.innerHTML = products.map(product => `
    <div class="product-card" data-id="${product.id}">
      <div class="product-image">
        ${getProductEmoji(product)}
      </div>
      <div class="product-info">
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-footer">
          <span class="product-price">${formatPrice(product.price)}</span>
          <button class="add-to-cart-btn" onclick="addToCart(${product.id})">
            <span>➕</span> В корзину
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function getProductEmoji(product) {
  const emojis = {
    1: '💧', // Жидкости
    2: '🔥', // Поды
    3: '🔧', // Расходники
    4: '🎁'  // Наборы
  };
  return emojis[product.category_id] || '📦';
}

function renderCart() {
  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛒</div>
        <div class="empty-state-text">Корзина пуста</div>
      </div>
    `;
    totalPrice.textContent = '0 ₽';
    return;
  }
  
  cartItems.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-image">${getProductEmoji(item)}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatPrice(item.price)}</div>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" onclick="updateQty(${item.id}, -1)">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" onclick="updateQty(${item.id}, 1)">+</button>
      </div>
    </div>
  `).join('');
  
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  totalPrice.textContent = formatPrice(total);
  updateCartCount();
}

function renderOrderSummary() {
  orderSummary.innerHTML = cart.map(item => `
    <div class="order-item">
      <span>${escapeHtml(item.name)} x${item.quantity}</span>
      <span>${formatPrice(item.price * item.quantity)}</span>
    </div>
  `).join('');
  
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  totalAmount.textContent = formatPrice(total);
}

// === ФУНКЦИИ ===

function selectCategory(categoryId) {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category == categoryId);
  });
  
  if (categoryId === 'all') {
    loadProducts();
  } else {
    loadProducts(categoryId);
  }
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.quantity++;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: 1
    });
  }
  
  renderCart();
  showToast('✅ Добавлено в корзину', 'success');
  
  // Анимация кнопки корзины
  cartBtn.style.transform = 'scale(1.2)';
  setTimeout(() => {
    cartBtn.style.transform = 'scale(1)';
  }, 200);
  
  // Haptic feedback
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
}

function updateQty(productId, delta) {
  const item = cart.find(item => item.id === productId);
  if (!item) return;
  
  item.quantity += delta;
  
  if (item.quantity <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  
  renderCart();
  
  if (tg.HapticFeedback) {
    tg.HapticFeedback.impactOccurred('light');
  }
}

function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartCount.textContent = count;
  cartCount.style.display = count > 0 ? 'flex' : 'none';
}

function openCart() {
  renderCart();
  cartModal.classList.add('active');
}

function closeCartModal() {
  cartModal.classList.remove('active');
}

function openCheckout() {
  if (cart.length === 0) {
    showToast('🛒 Корзина пуста', 'error');
    return;
  }
  
  closeCartModal();
  renderOrderSummary();
  checkoutModal.classList.add('active');
}

function closeCheckoutModal() {
  checkoutModal.classList.remove('active');
}

async function submitOrder(e) {
  e.preventDefault();
  
  const contactInfo = document.getElementById('contactInfo').value.trim();
  const deliveryAddress = document.getElementById('deliveryAddress').value.trim();
  const comment = document.getElementById('comment').value.trim();
  
  if (!contactInfo) {
    showToast('📞 Введите контакты', 'error');
    return;
  }
  
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  
  const orderData = {
    userId: tg.initDataUnsafe?.user?.id || 0,
    items: cart.map(item => ({
      product_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity
    })),
    totalAmount: total,
    deliveryAddress,
    contactInfo,
    comment
  };
  
  showLoader();
  
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    
    const result = await response.json();
    
    if (result.success) {
      hideLoader();
      closeCheckoutModal();
      cart = [];
      renderCart();
      updateCartCount();
      showToast('✅ Заказ оформлен!', 'success');
      
      // Закрыть Mini App через небольшую задержку
      setTimeout(() => {
        tg.close();
      }, 1500);
    } else {
      throw new Error('Ошибка при создании заказа');
    }
  } catch (error) {
    console.error('Ошибка:', error);
    hideLoader();
    showToast('❌ Ошибка оформления заказа', 'error');
  }
}

function showToast(message, type = '') {
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function showLoader() {
  loader.classList.add('active');
}

function hideLoader() {
  loader.classList.remove('active');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatPrice(price) {
  return `${price.toLocaleString('ru-RU')} ₽`;
}

// === СОБЫТИЯ ===

cartBtn.addEventListener('click', openCart);
closeCart.addEventListener('click', closeCartModal);
checkoutBtn.addEventListener('click', openCheckout);
closeCheckout.addEventListener('click', closeCheckoutModal);
checkoutForm.addEventListener('submit', submitOrder);

// Закрытие по клику на overlay
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', () => {
    cartModal.classList.remove('active');
    checkoutModal.classList.remove('active');
  });
});

// Инициализация
loadCategories();
loadProducts();

// Настройка цветов темы
document.documentElement.style.setProperty('--tg-theme-bg-color', tg.backgroundColor || '#1a1a2e');
document.documentElement.style.setProperty('--tg-theme-text-color', tg.textColor || '#ffffff');
