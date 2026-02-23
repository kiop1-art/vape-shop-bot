const db = require('./bot/database');

async function seed() {
  await db.initDatabase();
  
  // Добавляем категории
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

  // Добавляем товары
  const products = [
    // Жидкости
    { category_id: 1, name: 'Husky Double Ice', description: 'Ледяной манго-маракуйя с двойной концентрацией', price: 450, stock: 50 },
    { category_id: 1, name: 'Brusko Berry', description: 'Смесь лесных ягод с прохладой', price: 390, stock: 30 },
    { category_id: 1, name: 'SALTIC Lemon', description: 'Свежий лимон с мятой и льдом', price: 420, stock: 45 },
    { category_id: 1, name: 'Maxwells Crown', description: 'Виноград с ананасом и льдом', price: 490, stock: 40 },
    { category_id: 1, name: 'Chaser Kiwi', description: 'Сочный киви с яблоком', price: 350, stock: 60 },
    
    // Поды
    { category_id: 2, name: 'Vaporesso XROS 3', description: 'Компактный под-система с отличным вкусом', price: 2490, stock: 15 },
    { category_id: 2, name: 'Voopoo V.Thru', description: 'Стильный POD с керамическим испарителем', price: 1990, stock: 20 },
    { category_id: 2, name: 'GeekVape Aegis Hero', description: 'Надёжный под с защитой от влаги', price: 3290, stock: 10 },
    { category_id: 2, name: 'Smok Nord 5', description: 'Мощный POD с большим аккумулятором', price: 2790, stock: 12 },
    
    // Расходники
    { category_id: 3, name: 'Испарители XROS 0.6', description: 'Комплект из 4 испарителей', price: 890, stock: 100 },
    { category_id: 3, name: 'Испарители XROS 0.8', description: 'Комплект из 4 испарителей', price: 890, stock: 100 },
    { category_id: 3, name: 'Картриджи V.Thru', description: 'Комплект из 3 картриджей', price: 650, stock: 80 },
    { category_id: 3, name: 'Испарители Aegis B Series', description: 'Комплект из 5 испарителей', price: 1200, stock: 50 },
    
    // Наборы
    { category_id: 4, name: 'Стартовый набор', description: 'Vaporesso XROS 3 + 2 жидкости в подарок', price: 2990, stock: 10 },
    { category_id: 4, name: 'Набор для парения', description: 'Pod + 3 жидкости + испарители', price: 3990, stock: 8 },
    { category_id: 4, name: 'Зимний набор', description: 'Холодные вкусы: мята, лёд, цитрусы', price: 1990, stock: 15 }
  ];

  console.log('🛍️ Добавление товаров...');
  products.forEach(prod => {
    db.prepare(`
      INSERT INTO products (category_id, name, description, price, stock) 
      VALUES (?, ?, ?, ?, ?)
    `).run(prod.category_id, prod.name, prod.description, prod.price, prod.stock);
  });

  console.log('✅ База данных успешно заполнена!');
  console.log(`📊 Добавлено категорий: ${categories.length}`);
  console.log(`📦 Добавлено товаров: ${products.length}`);
  
  process.exit(0);
}

seed().catch(console.error);
