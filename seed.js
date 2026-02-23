const db = require('./bot/database');

async function seed() {
  await db.initDatabase();
  
  // Категории
  const categories = [
    { name: '💧 Жидкости', description: 'Жидкости для вейпов', icon: '💧', sort_order: 1 },
    { name: '🔥 Поды', description: 'Pod-системы', icon: '🔥', sort_order: 2 },
    { name: '🔧 Расходники', description: 'Испарители, картриджи', icon: '🔧', sort_order: 3 },
    { name: '🎁 Наборы', description: 'Выгодные наборы', icon: '🎁', sort_order: 4 }
  ];

  console.log('📂 Добавление категорий...');
  categories.forEach(cat => {
    db.prepare('INSERT INTO categories (name, description, icon, sort_order) VALUES (?, ?, ?, ?)')
      .run(cat.name, cat.description, cat.icon, cat.sort_order);
  });

  // Товары
  const products = [
    { category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя', price: 450, stock: 50 },
    { category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод', price: 390, stock: 30 },
    { category_id: 1, name: 'SALTIC Lemon', description: 'Свежий лимон с мятой', price: 420, stock: 45 },
    { category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под-система', price: 2490, stock: 15 },
    { category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD', price: 1990, stock: 20 },
    { category_id: 3, name: 'Испарители XROS 0.6Ω', description: '4 шт в упаковке', price: 890, stock: 100 },
    { category_id: 3, name: 'Картриджи V.Thru', description: '3 шт', price: 650, stock: 80 },
    { category_id: 4, name: 'Стартовый набор', description: 'XROS 3 + 2 жидкости', price: 2990, stock: 10 }
  ];

  console.log('🛍️ Добавление товаров...');
  products.forEach(prod => {
    db.prepare('INSERT INTO products (category_id, name, description, price, stock) VALUES (?, ?, ?, ?, ?)')
      .run(prod.category_id, prod.name, prod.description, prod.price, prod.stock);
  });

  // Тестовые новости
  const news = [
    { 
      title: '🎉 Открытие магазина!', 
      content: 'Мы открылись! Добавляем новые товары каждый день. Следите за обновлениями и используйте промокод WELCOME для скидки 10%!', 
      image_url: null 
    },
    {
      title: '🔥 Новые поступления',
      content: 'В каталоге появились новые жидкости от Husky и Brusko. Успейте попробовать!',
      image_url: null
    },
    {
      title: '🎁 Акция недели',
      content: 'При покупке стартового набора — жидкость в подарок! Акция действует до конца недели.',
      image_url: null
    }
  ];

  console.log('📰 Добавление новостей...');
  news.forEach(n => {
    db.prepare('INSERT INTO news (title, content, image_url) VALUES (?, ?, ?)')
      .run(n.title, n.content, n.image_url);
  });

  // Тестовые промокоды
  const promocodes = [
    { code: 'WELCOME', discount: 10, max_uses: 100 },
    { code: 'SALE20', discount: 20, max_uses: 50 },
    { code: 'VIP', discount: 30, max_uses: null }
  ];

  console.log('🎁 Добавление промокодов...');
  promocodes.forEach(p => {
    db.prepare('INSERT INTO promocodes (code, discount, max_uses) VALUES (?, ?, ?)')
      .run(p.code, p.discount, p.max_uses);
  });

  console.log('\n✅ База данных заполнена!');
  console.log(`📊 Категорий: ${categories.length}`);
  console.log(`🛍️ Товаров: ${products.length}`);
  console.log(`📰 Новостей: ${news.length}`);
  console.log(`🎁 Промокодов: ${promocodes.length}`);
  
  process.exit(0);
}

seed().catch(console.error);
