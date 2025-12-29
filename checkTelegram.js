const https = require('https');

const TOKEN = '8527870966:AAGlCmyPILZYrOiYuM4cgSgO1_eNOvKo_9g'; // <-- без скобок <>
const url = `https://api.telegram.org/bot${TOKEN}/getMe`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Ответ от Telegram:', data);
  });
}).on('error', err => {
  console.error('Ошибка HTTPS:', err);
});
