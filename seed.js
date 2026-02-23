const db = require('./bot/database');

async function seed() {
  try {
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
      { category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя', price: 450, stock: 50 },
      { category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод', price: 390, stock: 30 },
      { category_id: 1, name: 'SALTIC Lemon', description: 'Свежий лимон с мятой', price: 420, stock: 45 },
      { category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под', price: 2490, stock: 15 },
      { category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD', price: 1990, stock: 20 },
      { category_id: 3, name: 'Испарители XROS 0.6Ω', description: '4 шт', price: 890, stock: 100 },
      { category_id: 3, name: 'Картриджи V.Thru', description: '3 шт', price: 650, stock: 80 },
      { category_id: 4, name: 'Стартовый набор', description: 'XROS 3 + 2 жидкости', price: 2990, stock: 10 }
    ];

    console.log('\n🛍️ Добавление товаров...');
    products.forEach(prod => {
      db.prepare('INSERT INTO products (category_id, name, description, price, stock) VALUES (?, ?, ?, ?, ?)')
        .run(prod.category_id, prod.name, prod.description, prod.price, prod.stock);
    });
    console.log(`✅ Добавлено товаров: ${products.length}`);

    // Новости
    const news = [
      { title: '🎉 Открытие!', content: 'Мы открылись! Скидка 10% по промокоду WELCOME', image_url: null },
      { title: '🔥 Новинки', content: 'Новые жидкости от Husky и Brusko уже в продаже!', image_url: null }
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
      { code: 'SALE20', discount: 20, max_uses: 50 }
    ];

    console.log('\n🎁 Добавление промокодов...');
    promocodes.forEach(p => {
      db.prepare('INSERT INTO promocodes (code, discount, max_uses) VALUES (?, ?, ?)')
        .run(p.code, p.discount, p.max_uses);
    });
    console.log(`✅ Добавлено промокодов: ${promocodes.length}`);

    console.log('\n✅ База данных успешно заполнена!');
    process.exit(0);
  } catch (e) {
    console.error('❌ Ошибка:', e);
    process.exit(1);
  }
}

seed();
