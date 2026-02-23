const db = require('./bot/database');

async function seed() {
  await db.initDatabase();
  
  // Очищаем старые данные
  db.exec('DELETE FROM categories');
  db.exec('DELETE FROM products');
  db.exec('DELETE FROM news');
  db.exec('DELETE FROM promocodes');
  
  console.log('🗑️ База данных очищена');
  
  // Категории
  const categories = [
    { name: '💧 Жидкости', description: 'Жидкости для вейпов', icon: '💧', sort_order: 1 },
    { name: '🔥 Поды', description: 'Pod-системы', icon: '🔥', sort_order: 2 },
    { name: '🔧 Расходники', description: 'Испарители, картриджи', icon: '🔧', sort_order: 3 },
    { name: '🎁 Наборы', description: 'Выгодные наборы', icon: '🎁', sort_order: 4 }
  ];

  console.log('\n📂 Добавление категорий...');
  categories.forEach(cat => {
    db.prepare('INSERT INTO categories (name, description, icon, sort_order) VALUES (?, ?, ?, ?)')
      .run(cat.name, cat.description, cat.icon, cat.sort_order);
  });
  console.log(`✅ Добавлено категорий: ${categories.length}`);

  // Товары
  const products = [
    // Жидкости
    { category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя с двойной концентрацией', price: 450, stock: 50 },
    { category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод с прохладой', price: 390, stock: 30 },
    { category_id: 1, name: 'SALTIC Lemon', description: 'Свежий лимон с мятой и льдом', price: 420, stock: 45 },
    { category_id: 1, name: 'Maxwells Crown', description: 'Виноград с ананасом и льдом', price: 490, stock: 40 },
    { category_id: 1, name: 'Chaser Kiwi', description: 'Сочный киви с яблоком', price: 350, stock: 60 },
    
    // Поды
    { category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под-система', price: 2490, stock: 15 },
    { category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD с керамическим испарителем', price: 1990, stock: 20 },
    { category_id: 2, name: 'GeekVape Aegis Hero', description: 'Надёжный под с защитой от влаги', price: 3290, stock: 10 },
    { category_id: 2, name: 'Smok Nord 5', description: 'Мощный POD с большим аккумулятором', price: 2790, stock: 12 },
    
    // Расходники
    { category_id: 3, name: 'Испарители XROS 0.6Ω', description: 'Комплект из 4 испарителей', price: 890, stock: 100 },
    { category_id: 3, name: 'Испарители XROS 0.8Ω', description: 'Комплект из 4 испарителей', price: 890, stock: 100 },
    { category_id: 3, name: 'Картриджи V.Thru', description: 'Комплект из 3 картриджей', price: 650, stock: 80 },
    { category_id: 3, name: 'Испарители Aegis B Series', description: 'Комплект из 5 испарителей', price: 1200, stock: 50 },
    
    // Наборы
    { category_id: 4, name: 'Стартовый набор', description: 'Vaporesso XROS 3 + 2 жидкости в подарок', price: 2990, stock: 10 },
    { category_id: 4, name: 'Набор для парения', description: 'Pod + 3 жидкости + испарители', price: 3990, stock: 8 },
    { category_id: 4, name: 'Зимний набор', description: 'Холодные вкусы: мята, лёд, цитрусы', price: 1990, stock: 15 }
  ];

  console.log('\n🛍️ Добавление товаров...');
  products.forEach(prod => {
    db.prepare('INSERT INTO products (category_id, name, description, price, stock) VALUES (?, ?, ?, ?, ?)')
      .run(prod.category_id, prod.name, prod.description, prod.price, prod.stock);
  });
  console.log(`✅ Добавлено товаров: ${products.length}`);

  // Новости
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

  console.log('\n📰 Добавление новостей...');
  news.forEach(n => {
    db.prepare('INSERT INTO news (title, content, image_url) VALUES (?, ?, ?)')
      .run(n.title, n.content, n.image_url);
  });
  console.log(`✅ Добавлено новостей: ${news.length}`);

  // Промокоды
  const promocodes = [
    { code: 'WELCOME', discount: 10, max_uses: 100 },
    { code: 'SALE20', discount: 20, max_uses: 50 },
    { code: 'VIP', discount: 30, max_uses: null }
  ];

  console.log('\n🎁 Добавление промокодов...');
  promocodes.forEach(p => {
    db.prepare('INSERT INTO promocodes (code, discount, max_uses) VALUES (?, ?, ?)')
      .run(p.code, p.discount, p.max_uses);
  });
  console.log(`✅ Добавлено промокодов: ${promocodes.length}`);

  // Проверка
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const prods = db.prepare('SELECT * FROM products LIMIT 5').all();
  
  console.log('\n✅ База данных успешно заполнена!');
  console.log(`\n📊 Категории: ${cats.length}`);
  cats.forEach(c => console.log(`   ${c.id}. ${c.name}`));
  console.log(`\n🛍️ Товары: ${db.prepare('SELECT COUNT(*) as c FROM products').get().c}`);
  console.log(`\n📰 Новости: ${db.prepare('SELECT COUNT(*) as c FROM news').get().c}`);
  console.log(`\n🎁 Промокоды: ${db.prepare('SELECT COUNT(*) as c FROM promocodes').get().c}`);
  
  process.exit(0);
}

seed().catch(console.error);
