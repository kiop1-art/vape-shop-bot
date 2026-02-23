const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

let cart = [];
let products = [];
let categories = [];
let news = [];
let orders = [];
let currentFilter = 'all';
let currentDiscount = 0;
let appliedPromocode = null;

const categoriesEl = document.getElementById('categories');
const categoriesWrapper = document.getElementById('categoriesWrapper');
const productsGrid = document.getElementById('productsGrid');
const ordersList = document.getElementById('ordersList');
const newsGrid = document.getElementById('newsGrid');
const cartBtn = document.getElementById('cartBtn');
const cartCount = document.getElementById('cartCount');
const cartModal = document.getElementById('cartModal');
const cartItems = document.getElementById('cartItems');
const totalPrice = document.getElementById('totalPrice');
const totalOld = document.getElementById('totalOld');
const checkoutBtn = document.getElementById('checkoutBtn');
const closeCart = document.getElementById('closeCart');
const promocodeInput = document.getElementById('promocodeInput');
const applyPromocode = document.getElementById('applyPromocode');
const checkoutModal = document.getElementById('checkoutModal');
const closeCheckout = document.getElementById('closeCheckout');
const checkoutForm = document.getElementById('checkoutForm');
const orderSummary = document.getElementById('orderSummary');
const totalAmount = document.getElementById('totalAmount');
const toast = document.getElementById('toast');
const loader = document.getElementById('loader');
const orderDetailModal = document.getElementById('orderDetailModal');
const orderDetailId = document.getElementById('orderDetailId');
const orderDetailBody = document.getElementById('orderDetailBody');

const tabBtns = document.querySelectorAll('.tab-btn');
const shopTab = document.getElementById('shopTab');
const ordersTab = document.getElementById('ordersTab');
const newsTab = document.getElementById('newsTab');

const statusLabels = {
  'pending': { text: '⏳ На обработке', color: '#f59e0b' },
  'confirmed': { text: '✅ Подтверждён', color: '#10b981' },
  'shipping': { text: '🚀 В доставке', color: '#3b82f6' },
  'completed': { text: '✨ Завершён', color: '#8b5cf6' },
  'cancelled': { text: '❌ Отменён', color: '#ef4444' }
};

// Время Екатеринбурга (UTC+5)
function formatEkaterinburgTime(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      timeZone: 'Asia/Yekaterinburg',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return new Date(dateString).toLocaleString('ru-RU');
  }
}

// === ЗАГРУЗКА ДАННЫХ ===

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    categories = await res.json();
    console.log('Категории:', categories);
  } catch (e) {
    console.error('Ошибка загрузки категорий:', e);
    categories = [
      { id: 1, name: '💧 Жидкости' },
      { id: 2, name: '🔥 Поды' },
      { id: 3, name: '🔧 Расходники' },
      { id: 4, name: '🎁 Наборы' }
    ];
  }
  renderCategories();
}

async function loadProducts(categoryId = null) {
  showLoader();
  try {
    const url = categoryId ? `/api/products?category_id=${categoryId}` : '/api/products';
    console.log('Загрузка товаров:', url);
    const res = await fetch(url);
    products = await res.json();
    console.log('Товары:', products);
  } catch (e) {
    console.error('Ошибка загрузки товаров:', e);
    products = getDemoProducts();
  }
  hideLoader();
  renderProducts();
}

async function loadNews() {
  try {
    const res = await fetch('/api/news');
    news = await res.json();
    console.log('Новости:', news);
  } catch (e) {
    console.error('Ошибка загрузки новостей:', e);
    news = [];
  }
  renderNews();
}

async function loadOrders() {
  showLoader();
  try {
    const userId = tg.initDataUnsafe?.user?.id;
    console.log('Загрузка заказов для userId:', userId);
    
    if (!userId) {
      orders = [];
      renderOrders();
      hideLoader();
      return;
    }
    
    const res = await fetch(`/api/orders?user_id=${userId}`);
    orders = await res.json();
    console.log('Заказы:', orders);
    renderOrders();
  } catch (e) {
    console.error('Ошибка загрузки заказов:', e);
    orders = [];
  }
  hideLoader();
}

function getDemoProducts() {
  return [
    { id: 1, category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя', price: 450, image_url: '' },
    { id: 2, category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод', price: 390, image_url: '' },
    { id: 3, category_id: 1, name: 'SALTIC Lemon', description: 'Свежий лимон с мятой', price: 420, image_url: '' },
    { id: 4, category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под', price: 2490, image_url: '' },
    { id: 5, category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD', price: 1990, image_url: '' },
    { id: 6, category_id: 3, name: 'Испарители XROS 0.6Ω', description: '4 шт', price: 890, image_url: '' },
    { id: 7, category_id: 3, name: 'Картриджи V.Thru', description: '3 шт', price: 650, image_url: '' },
    { id: 8, category_id: 4, name: 'Стартовый набор', description: 'XROS 3 + 2 жидкости', price: 2990, image_url: '' }
  ];
}

// === РЕНДЕРИНГ ===

function renderCategories() {
  if (!categoriesEl) return;
  
  categoriesEl.innerHTML = '';
  
  const allBtn = document.createElement('button');
  allBtn.className = 'category-btn active';
  allBtn.textContent = 'Все';
  allBtn.dataset.category = 'all';
  allBtn.onclick = () => selectCategory('all');
  categoriesEl.appendChild(allBtn);
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = cat.name;
    btn.dataset.category = cat.id;
    btn.onclick = () => selectCategory(cat.id);
    categoriesEl.appendChild(btn);
  });
  
  console.log('Категории отрендерены:', categoriesEl.children.length);
}

function renderProducts() {
  if (!productsGrid) return;
  
  if (products.length === 0) {
    productsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">В этой категории<br>пока нет товаров</div>
      </div>
    `;
    return;
  }
  
  productsGrid.innerHTML = products.map(p => {
    const hasImage = p.image_url && p.image_url.trim() !== '' && !p.image_url.includes('placeholder');
    
    return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-image">
        ${hasImage 
          ? `<img src="${p.image_url}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';this.parentElement.textContent='${getProductEmoji(p)}'">`
          : getProductEmoji(p)}
      </div>
      <div class="product-info">
        <h3 class="product-name">${escapeHtml(p.name)}</h3>
        <p class="product-description">${escapeHtml(p.description)}</p>
        <div class="product-footer">
          <span class="product-price">${formatPrice(p.price)}</span>
          <button class="add-to-cart-btn" onclick="addToCart(${p.id})">+</button>
        </div>
      </div>
    </div>
  `}).join('');
  
  console.log('Товары отрендерены:', products.length);
}

function renderOrders() {
  if (!ordersList) return;
  
  // Фильтрация заказов
  const filteredOrders = getFilteredOrders(currentFilter);
  
  if (filteredOrders.length === 0) {
    const filterNames = {
      'all': 'заказов',
      'pending': 'новых заказов',
      'confirmed': 'принятых заказов',
      'completed': 'завершённых заказов'
    };
    
    ordersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <div class="empty-state-text">У вас нет ${filterNames[currentFilter] || 'заказов'}</div>
      </div>
    `;
    return;
  }
  
  ordersList.innerHTML = filteredOrders.map(order => {
    const status = statusLabels[order.status] || { text: order.status, color: '#888' };
    return `
      <div class="order-card" onclick="showOrderDetail(${order.id})">
        <div class="order-header">
          <span class="order-id">#${order.order_uuid.substring(0, 8)}</span>
          <span class="order-status" style="color: ${status.color}">${status.text}</span>
        </div>
        <div class="order-info">
          <span class="order-date">${formatEkaterinburgTime(order.created_at)}</span>
          <span class="order-total">${formatPrice(order.total_amount)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function getFilteredOrders(filter) {
  if (filter === 'all') return orders;
  if (filter === 'pending') return orders.filter(o => o.status === 'pending');
  if (filter === 'confirmed') return orders.filter(o => o.status === 'confirmed' || o.status === 'shipping');
  if (filter === 'completed') return orders.filter(o => o.status === 'completed');
  return orders;
}

function showOrderDetail(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  
  const status = statusLabels[order.status] || { text: order.status, color: '#888' };
  
  orderDetailId.textContent = order.order_uuid.substring(0, 8);
  
  const itemsHtml = order.items && order.items.length > 0
    ? order.items.map(item => `
        <div class="order-item">
          <span>${escapeHtml(item.product_name)} × ${item.quantity}</span>
          <span>${formatPrice(item.price * item.quantity)}</span>
        </div>
      `).join('')
    : '<p>Нет товаров</p>';
  
  orderDetailBody.innerHTML = `
    <div class="order-detail">
      <div class="status-badge" style="background: ${status.color}20; color: ${status.color}; border-color: ${status.color}">
        ${status.text}
      </div>

      <div class="detail-section">
        <h4>📅 Дата заказа</h4>
        <p>${formatEkaterinburgTime(order.created_at)}</p>
      </div>

      <div class="detail-section">
        <h4>💰 Сумма</h4>
        <p class="price-large">${formatPrice(order.total_amount)}</p>
      </div>

      ${order.contact_info ? `
      <div class="detail-section">
        <h4>📞 Контакты</h4>
        <p>${escapeHtml(order.contact_info)}</p>
      </div>
      ` : ''}

      ${order.delivery_address ? `
      <div class="detail-section">
        <h4>📍 Адрес</h4>
        <p>${escapeHtml(order.delivery_address)}</p>
      </div>
      ` : ''}

      ${order.comment ? `
      <div class="detail-section">
        <h4>💬 Комментарий</h4>
        <p>${escapeHtml(order.comment)}</p>
      </div>
      ` : ''}

      ${order.promocode ? `
      <div class="detail-section">
        <h4>🎁 Промокод</h4>
        <p>${escapeHtml(order.promocode)}</p>
      </div>
      ` : ''}

      <div class="detail-section">
        <h4>🛒 Товары</h4>
        <div class="order-items">${itemsHtml}</div>
      </div>

      ${order.status === 'completed' ? `<button class="btn-primary" onclick="repeatOrder(${order.id})" style="margin-top: 16px;">🔄 Повторить заказ</button>` : ''}
    </div>
  `;

  orderDetailModal.classList.add('active');
}

function repeatOrder(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order || !order.items) return;
  
  order.items.forEach(item => {
    const existing = cart.find(c => c.id === item.product_id);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      cart.push({
        id: item.product_id,
        name: item.product_name,
        price: item.price,
        quantity: item.quantity
      });
    }
  });
  
  renderCart();
  updateCartTotal();
  orderDetailModal.classList.remove('active');
  showToast('✅ Товары добавлены в корзину', 'success');
  
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('success');
}

function renderNews() {
  if (!newsGrid) return;
  
  if (news.length === 0) {
    newsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📰</div>
        <div class="empty-state-text">Новостей пока нет</div>
      </div>
    `;
    return;
  }
  
  newsGrid.innerHTML = news.map(n => {
    const hasImage = n.image_url && n.image_url.trim() !== '';
    
    return `
    <div class="news-card">
      <div class="news-image">
        ${hasImage 
          ? `<img src="${n.image_url}" alt="${escapeHtml(n.title)}" onerror="this.style.display='none';this.parentElement.textContent='📢'">`
          : '📢'}
      </div>
      <div class="news-content">
        <h3 class="news-title">${escapeHtml(n.title)}</h3>
        <p class="news-text">${escapeHtml(n.content)}</p>
        <div class="news-date">${formatEkaterinburgTime(n.created_at)}</div>
      </div>
    </div>
  `}).join('');
}

function getProductEmoji(product) {
  const emojis = { 1: '💧', 2: '🔥', 3: '🔧', 4: '🎁' };
  return emojis[product.category_id] || '📦';
}

function renderCart() {
  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="empty-cart">
        <div class="empty-cart-icon">🛒</div>
        <p>Корзина пуста</p>
      </div>
    `;
    updateCartTotal();
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
  
  updateCartTotal();
}

function updateCartTotal() {
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = currentDiscount > 0 ? total * (currentDiscount / 100) : 0;
  const finalTotal = total - discount;
  
  if (discount > 0) {
    totalOld.textContent = formatPrice(total);
    totalOld.style.display = 'block';
    totalPrice.textContent = formatPrice(finalTotal);
  } else {
    totalOld.textContent = '';
    totalOld.style.display = 'none';
    totalPrice.textContent = formatPrice(total);
  }
  
  updateCartCount();
}

function renderOrderSummary() {
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = currentDiscount > 0 ? total * (currentDiscount / 100) : 0;
  const finalTotal = total - discount;
  
  orderSummary.innerHTML = cart.map(item => `
    <div class="order-item">
      <span>${escapeHtml(item.name)} × ${item.quantity}</span>
      <span>${formatPrice(item.price * item.quantity)}</span>
    </div>
  `).join('');
  
  if (discount > 0) {
    orderSummary.innerHTML += `
      <div class="order-item" style="color: var(--primary)">
        <span>Скидка ${currentDiscount}%</span>
        <span>-${formatPrice(discount)}</span>
      </div>
    `;
  }
  
  totalAmount.textContent = formatPrice(finalTotal);
}

// === ФУНКЦИИ ===

function selectCategory(categoryId) {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category == categoryId);
  });
  loadProducts(categoryId === 'all' ? null : categoryId);
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({ ...product, quantity: 1 });
  }
  
  renderCart();
  showToast('Добавлено в корзину', 'success');
  
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function updateQty(productId, delta) {
  const item = cart.find(item => item.id === productId);
  if (!item) return;
  
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  
  renderCart();
  
  if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
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
    showToast('Корзина пуста', 'error');
    return;
  }
  closeCartModal();
  renderOrderSummary();
  checkoutModal.classList.add('active');
}

function closeCheckoutModal() {
  checkoutModal.classList.remove('active');
}

async function validatePromocode(code) {
  try {
    const res = await fetch('/api/validate-promocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const result = await res.json();
    return result;
  } catch (e) {
    return { valid: false, error: 'Ошибка проверки' };
  }
}

async function submitOrder(e) {
  e.preventDefault();
  
  const contactInfo = document.getElementById('contactInfo').value.trim();
  const deliveryAddress = document.getElementById('deliveryAddress').value.trim();
  const comment = document.getElementById('comment').value.trim();
  
  if (!contactInfo) {
    showToast('Введите контакты', 'error');
    return;
  }
  
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = currentDiscount > 0 ? total * (currentDiscount / 100) : 0;
  const finalTotal = total - discount;
  
  const orderData = {
    userId: tg.initDataUnsafe?.user?.id || 0,
    items: cart.map(item => ({
      product_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity
    })),
    totalAmount: finalTotal,
    deliveryAddress,
    contactInfo,
    comment,
    promocode: appliedPromocode
  };
  
  showLoader();
  
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    
    const result = await res.json();
    
    if (result.success) {
      closeCheckoutModal();
      cart = [];
      currentDiscount = 0;
      appliedPromocode = null;
      promocodeInput.value = '';
      renderCart();
      updateCartTotal();
      showToast('Заказ оформлен!', 'success');
      
      // Обновляем список заказов
      loadOrders();
      
      setTimeout(() => tg.close(), 1500);
    } else {
      showToast('Ошибка оформления', 'error');
    }
  } catch (e) {
    showToast('Ошибка оформления', 'error');
  }
}

function showToast(message, type = '') {
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.className = 'toast', 3000);
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

// Фильтры заказов
const orderFilters = document.getElementById('orderFilters');
if (orderFilters) {
  orderFilters.addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-btn')) {
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderOrders();
      
      if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    }
  });
}

// Переключение табов
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const tabName = btn.dataset.tab;
    
    if (tabName === 'shop') {
      shopTab.classList.add('active');
      ordersTab.classList.remove('active');
      newsTab.classList.remove('active');
      categoriesWrapper.style.display = 'block';
    } else if (tabName === 'orders') {
      shopTab.classList.remove('active');
      ordersTab.classList.add('active');
      newsTab.classList.remove('active');
      categoriesWrapper.style.display = 'none';
      loadOrders();
    } else {
      shopTab.classList.remove('active');
      ordersTab.classList.remove('active');
      newsTab.classList.add('active');
      categoriesWrapper.style.display = 'none';
      loadNews();
    }
    
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  });
});

cartBtn.onclick = openCart;
closeCart.onclick = closeCartModal;
document.querySelector('#cartModal .modal-backdrop').onclick = closeCartModal;
checkoutBtn.onclick = openCheckout;
closeCheckout.onclick = closeCheckoutModal;
document.querySelector('#checkoutModal .modal-backdrop').onclick = closeCheckoutModal;
checkoutForm.onsubmit = submitOrder;
document.querySelector('#orderDetailModal .modal-backdrop').onclick = () => orderDetailModal.classList.remove('active');

applyPromocode.onclick = async () => {
  const code = promocodeInput.value.trim();
  if (!code) {
    showToast('Введите промокод', 'error');
    return;
  }
  
  const result = await validatePromocode(code);
  
  if (result.valid) {
    currentDiscount = result.discount;
    appliedPromocode = code.toUpperCase();
    updateCartTotal();
    showToast(`Скидка ${result.discount}% применена!`, 'success');
    promocodeInput.value = '';
  } else {
    showToast(result.error || 'Неверный промокод', 'error');
  }
};

// Инициализация
console.log('Инициализация Mini App...');
loadCategories();
loadProducts();
loadNews();

// Настройка темы Telegram
if (tg.themeParams) {
  if (tg.themeParams.bg_color) document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color);
  if (tg.themeParams.text_color) document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color);
  if (tg.themeParams.button_color) document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color);
  if (tg.themeParams.secondary_bg_color) document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tg.themeParams.secondary_bg_color);
}
