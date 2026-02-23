/**
 * Скрипт для установки webhook на Vercel
 * Запуск: node set-webhook.js
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const vercelUrl = process.env.VERCEL_URL; // например: your-app.vercel.app

if (!vercelUrl) {
  console.error('❌ Укажите VERCEL_URL в .env файле (например: your-app.vercel.app)');
  process.exit(1);
}

const webhookUrl = `https://${vercelUrl}/webhook`;

const bot = new TelegramBot(token);

bot.setWebHook(webhookUrl).then(() => {
  console.log(`✅ Webhook установлен: ${webhookUrl}`);
  
  // Проверка текущего webhook
  return bot.getWebHookInfo();
}).then((info) => {
  console.log('📊 Информация:');
  console.log(`   URL: ${info.url}`);
  console.log(`   Ожидает обновлений: ${info.pending_update_count}`);
  process.exit(0);
}).catch((err) => {
  console.error('❌ Ошибка:', err.message);
  process.exit(1);
});
