






require("dotenv").config();

// server.js — бот + API + WebSocket + курьеры + хранилище JSON
// npm install express cors ws node-telegram-bot-api
const ADMIN_USERNAME = "crazycloud_manager"; // без @
console.log("TOKEN:", process.env.TELEGRAM_TOKEN ? "OK" : "НЕ НАЙДЕН");

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");

// ================= Настройки =================
const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = 7664644901; // твой ID
const PORT = 3000;
const HOST = "0.0.0.0";
const LOCAL_IP = "127.0.0.1"; // для локальной ссылки на сервер


// ================= Директория данных =================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SUBSCRIBERS_FILE = path.join(DATA_DIR, "subscribers.json");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");

// ================= Инициализация файлов =================
function ensureFile(file, init) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(init, null, 2), "utf8");
}
ensureFile(CLIENTS_FILE, {});
ensureFile(ORDERS_FILE, {});
ensureFile(SUBSCRIBERS_FILE, {});
ensureFile(STOCK_FILE, { elfbar: 10, "chaser-lux": 5, vozol: 8, "chaser-black": 7, "chaser-special": 4, "chaser-mix": 6 });

// ================= Утилиты =================
function readJSON(file) { try { return JSON.parse(fs.readFileSync(file,"utf8")||"{}"); } catch(e){console.error(e); return {};}}
function writeJSON(file,obj){ fs.writeFileSync(file, JSON.stringify(obj,null,2),"utf8");}

let clients = readJSON(CLIENTS_FILE);
let orders = readJSON(ORDERS_FILE);
let subscribers = readJSON(SUBSCRIBERS_FILE);
let stock = readJSON(STOCK_FILE);

// ================= Курьеры =================
let COURIERS = {}; // { username: chatId }

const deliveryMap = { "DHL": "📦 DHL", "Курьер": "🚚 Курьер" };
const paymentMap = { "Наличные": "💵 Наличные", "Карта": "💳 Банковская карта", "Криптовалюта": "🪙 Крипто" };

function saveAll() {
  writeJSON(CLIENTS_FILE, clients);
  writeJSON(ORDERS_FILE, orders);
  writeJSON(SUBSCRIBERS_FILE, subscribers);
  writeJSON(STOCK_FILE, stock);
}

// ================= Генерация заказа =================
function generateOrderId() {
  let id;
  do { id = String(Math.floor(100000 + Math.random() * 900000)); } 
  while(orders[id]);
  return id;
}

// ================= Экранирование Markdown =================
function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function buildOrderMessage(order){
  const courierText = order.courier_username 
    ? `\n🚀 Курьер: @${escapeMarkdownV2(order.courier_username)}` 
    : "";

  let statusText = "";
  switch(order.status){
    case "new": statusText = "Новый"; break;
    case "taken": statusText = "Взято"; break;
    case "delivered": statusText = "Доставлен"; break;
  }

  return [
    `🧾 *Заказ №${escapeMarkdownV2(order.id)}*`,
    ``,
    `👤 *Клиент:* ${escapeMarkdownV2(order.tgNick)}`,
    `🏙 *Город:* ${escapeMarkdownV2(order.city || "—")}`,
    `🚚 *Доставка:* ${escapeMarkdownV2(deliveryMap[order.delivery] || order.delivery || "—")}`,
    `💳 *Оплата:* ${escapeMarkdownV2(paymentMap[order.payment] || order.payment || "—")}`,
    `📅 *Дата:* ${escapeMarkdownV2(order.date || "—")}`,
    `⏰ *Время:* ${escapeMarkdownV2(order.time || "—")}`,
    ``,
    `🛒 *Состав заказа:*\n${escapeMarkdownV2(order.orderText)}`,
    ``,
    `ℹ️ Статус: *${statusText}*${courierText}`
  ].join("\n");
}

// ================= Telegram Bot =================
const bot = new TelegramBot(TOKEN, { polling:true });

// ================= Обновление сообщений заказа =================
async function updateAllMessages(order){
  if(!order.messages) order.messages = [];
  for(const m of order.messages){
    try{
      let kb = [];
      if(order.status==="new"){
        kb = [[{text:"📦 Взять заказ",callback_data:`take_${order.id}`}]];
      } else if(order.status==="taken"){
        kb = [[
          {text:"✅ Доставлен",callback_data:`delivered_${order.id}`},
          {text:"↩️ Отказаться",callback_data:`release_${order.id}`}
        ]];
      } // delivered — кнопок нет
      await bot.editMessageText(buildOrderMessage(order),{
        chat_id:m.chatId,
        message_id:m.messageId,
        parse_mode: "MarkdownV2",
        reply_markup: kb.length ? {inline_keyboard: kb} : undefined
      }).catch(err=>console.error("Edit message failed:", err));
    }catch(e){console.error(e);}
  }
}

// ================= Callback inline кнопки =================
bot.on("callback_query", async (q) => {
  const data = q.data || "";
  const fromId = q.from.id;
  const username = q.from.username || q.from.first_name;

  const orderId = data.split("_")[1];
  const order = orders[orderId];
  if (!order) return bot.answerCallbackQuery(q.id, { text: "Заказ не найден" });

  // --- Взять заказ ---
  if (data.startsWith("take_")) {
    if (order.status === "taken") return bot.answerCallbackQuery(q.id, { text: "Заказ уже взят", show_alert: true });
    if (!COURIERS[username] && fromId !== ADMIN_ID) return bot.answerCallbackQuery(q.id, { text: "Только курьеры могут брать заказ", show_alert: true });

    order.status = "taken";
    order.courier_username = username;
    order.taken_at = new Date().toISOString();

    await updateAllMessages(order);
    bot.answerCallbackQuery(q.id, { text: `Вы взяли заказ №${orderId}` });
    bot.sendMessage(ADMIN_ID, `🚀 Курьер @${username} взял заказ №${orderId}`);
    saveAll();
    return;
  }

  // --- Отказаться от заказа ---
  if (data.startsWith("release_")) {
    if (order.courier_username !== username && fromId !== ADMIN_ID)
      return bot.answerCallbackQuery(q.id, { text: "Вы не можете освободить этот заказ", show_alert: true });

    order.status = "new";
    order.courier_username = null;
    order.taken_at = null;

    await updateAllMessages(order);
    bot.answerCallbackQuery(q.id, { text: `Заказ №${orderId} снова доступен` });
    bot.sendMessage(ADMIN_ID, `⚠️ Курьер @${username} отказался от заказа №${orderId}`);
    saveAll();
    return;
  }

  // --- Доставлено ---
  if (data.startsWith("delivered_")) {
    if (order.courier_username !== username && fromId !== ADMIN_ID)
      return bot.answerCallbackQuery(q.id, { text: "Вы не можете отметить доставленным", show_alert: true });

    order.status = "delivered";
    order.delivered_at = new Date().toISOString();

    await updateAllMessages(order);
    bot.answerCallbackQuery(q.id, { text: `Заказ №${orderId} доставлен` });
    bot.sendMessage(ADMIN_ID, `✅ Курьер @${username} доставил заказ №${orderId}`);
    saveAll();
    return;
  }
});


// ================= Старт бота =================
// ================= Старт бота =================
bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const username = msg.from.username || `id${id}`;

  // Создаём или обновляем профиль клиента
  if (!clients[username]) {
    clients[username] = {
      id,
      username,
      first_name: msg.from.first_name || "",
      subscribed: true,
      city: "",
      orders: [],
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString()
    };
  } else {
    clients[username].last_active = new Date().toISOString();
    clients[username].subscribed = true;
  }
  saveAll();

  // --- Сообщение без web_app кнопки ---
  let welcomeText = "Добро пожаловать! 🛍 Чтобы оформить заказ откройте магазин.";
  
  if (username === ADMIN_USERNAME) {
    welcomeText += "\n👑 Панель администратора и Панель курьера доступны через текстовые кнопки ниже.";
  } else if (COURIERS[username]) {
    welcomeText += "\n🚚 Панель курьера доступна через текстовые кнопки ниже.";
  }

  bot.sendMessage(id, welcomeText, {
    reply_markup: {
      keyboard: [
        // Админ
        username === ADMIN_USERNAME ? [{ text: "Панель администратора" }, { text: "Панель курьера" }] :
        // Курьер
        COURIERS[username] ? [{ text: "Панель курьера" }] :
        // Обычный пользователь
        [{ text: "👤 Личный кабинет" }, { text: "📞 Поддержка" }]
      ],
      resize_keyboard: true
    }
  });
});





// ================= Обработка текстовых кнопок =================
bot.on("message", async (msg) => {
    const id = msg.from.id;
    const username = msg.from.username || `id${id}`;
    const text = msg.text || "";

    // Если профиля нет (на случай сообщений до /start)
    if (!clients[username]) {
        clients[username] = {
            id,
            username,
            first_name: msg.from.first_name || "",
            subscribed: true,
            city: "",
            orders: [],
            created_at: new Date().toISOString(),
            last_active: new Date().toISOString()
        };
        saveAll();
    } else {
        clients[username].last_active = new Date().toISOString();
        saveAll();
    }

    // ---------------- Личный кабинет ----------------
    if (text === "👤 Личный кабинет") {
        const client = clients[username];
        const info = [
            `👤 Имя: ${client.first_name || "—"}`,
            `🏙 Город: ${client.city || "—"}`,
            `🕒 Последняя активность: ${client.last_active || "—"}`,
            `📦 Всего заказов: ${client.orders?.length || 0}`
        ].join("\n");
        return bot.sendMessage(id, info);
    }

    // ---------------- Поддержка ----------------
    if (text === "📞 Поддержка") {
        return bot.sendMessage(id, "📞 Свяжитесь с поддержкой через @crazycloud_manager.");
    }

    // ---------------- Рассылка (админ) ----------------
    if (clients.__waiting_broadcast === id) {
        const msgText = text;
        Object.values(clients).forEach(c => {
            bot.sendMessage(c.id, msgText).catch(console.error);
        });
        bot.sendMessage(ADMIN_ID, "✅ Рассылка отправлена");
        delete clients.__waiting_broadcast;
        return;
    }

    // ---------------- Назад ----------------
    if (text === "Назад") {
        if (clients.__waiting_courier && clients.__waiting_courier[username]) delete clients.__waiting_courier[username];
        if (clients.__waiting_broadcast === id) delete clients.__waiting_broadcast;
        saveAll();

        if (id === ADMIN_ID) {
            const kb = { keyboard: [[{ text: "Панель администратора" }, { text: "Панель курьера" }]], resize_keyboard: true };
            return bot.sendMessage(id, "👑 Главное меню админа", { reply_markup: kb });
        } else if (Object.values(COURIERS).includes(id)) {
            const kb = { keyboard: [[{ text: "Панель курьера" }]], resize_keyboard: true };
            return bot.sendMessage(id, "🚚 Главное меню курьера", { reply_markup: kb });
        } else {
            const kb = { keyboard: [[{ text: "👤 Личный кабинет" }, { text: "📞 Поддержка" }]], resize_keyboard: true };
            return bot.sendMessage(id, "✔️ Главное меню", { reply_markup: kb });
        }
    }

    // ---------------- Ввод ника курьера ----------------
    if (clients.__waiting_courier && clients.__waiting_courier[username]) {
        const action = clients.__waiting_courier[username];
        if (!text.startsWith("@")) return bot.sendMessage(id, "❌ Ник должен начинаться с @");
        const uname = text.replace(/^@+/, "").trim();

        if (action === "add") {
            const client = clients[uname];
            if (client && client.id) COURIERS[uname] = client.id, bot.sendMessage(ADMIN_ID, `✅ Курьер @${uname} добавлен`);
            else bot.sendMessage(ADMIN_ID, `⚠️ Курьер @${uname} ещё не начал диалог с ботом.`);
        } else if (action === "remove") {
            delete COURIERS[uname];
            bot.sendMessage(ADMIN_ID, `⚠️ Курьер @${uname} удален`);
        }

        delete clients.__waiting_courier[username];
        saveAll();
        return;
    }

    // ---------------- Админка ----------------
    if (text === "Панель администратора" && id === ADMIN_ID) {
        const kb = { keyboard: [
            [{ text: "Добавить курьера" }, { text: "Удалить курьера" }],
            [{ text: "Список курьеров" }, { text: "Рассылка" }],
            [{ text: "Выполненные заказы" }, { text: "Назад" }]
        ], resize_keyboard: true };
        return bot.sendMessage(id, "👑 Панель администратора", { reply_markup: kb });
    }

    if ((text === "Добавить курьера" || text === "Удалить курьера") && id === ADMIN_ID) {
        const action = text === "Добавить курьера" ? "add" : "remove";
        bot.sendMessage(id, `Введите ник курьера (@username), чтобы ${action === "add" ? "добавить" : "удалить"}:`);
        if (!clients.__waiting_courier) clients.__waiting_courier = {};
        clients.__waiting_courier[username] = action;
        saveAll();
        return;
    }

    if (text === "Список курьеров" && id === ADMIN_ID) {
        let list = Object.keys(COURIERS);
        if (list.length === 0) list = ["Нет курьеров"];
        bot.sendMessage(ADMIN_ID, "📦 Список курьеров:\n" + list.map(u => `@${u}`).join("\n"));
        return;
    }

    if (text === "Рассылка" && id === ADMIN_ID) {
        bot.sendMessage(ADMIN_ID, "Введите текст для рассылки:");
        clients.__waiting_broadcast = id;
        return;
    }
    
  // ---------------- Курьерка ----------------
  if (text === "Панель курьера" && (Object.values(COURIERS).includes(id) || id === ADMIN_ID)) {
      const kb = { keyboard: [
          [{ text: "Активные заказы" }, { text: "Выполненные заказы" }],
          [{ text: "Назад" }]
      ], resize_keyboard: true };
      return bot.sendMessage(id, "🚚 Панель курьера", { reply_markup: kb });
  }

  // ---------------- Активные заказы ----------------
  if (text === "Активные заказы" && (Object.values(COURIERS).includes(id) || id === ADMIN_ID)) {
      const activeOrders = Object.values(orders).filter(o =>
          o.status === "new" || (o.status === "taken" && o.courier_username === username)
      );
      if (activeOrders.length === 0) return bot.sendMessage(id, "Нет активных заказов");

      for (const o of activeOrders) {
          if (!o.messages) o.messages = [];
          let kb = [];
          if (o.status === "new") kb = [[{ text: "📦 Взять заказ", callback_data: `take_${o.id}` }]];
          else if (o.status === "taken" && o.courier_username === username)
              kb = [[{ text: "✅ Доставлен", callback_data: `delivered_${o.id}` }, { text: "↩️ Отказаться", callback_data: `release_${o.id}` }]];

          const sent = await bot.sendMessage(id, buildOrderMessage(o), {
              parse_mode: "MarkdownV2",
              reply_markup: kb.length ? { inline_keyboard: kb } : undefined
          });
          o.messages.push({ chatId: sent.chat.id, messageId: sent.message_id });
          await updateAllMessages(o);
      }

      saveAll();
      return;
  }

  // ---------------- Выполненные заказы ----------------
  if (text === "Выполненные заказы" && (Object.values(COURIERS).includes(id) || id === ADMIN_ID)) {
      if (id === ADMIN_ID) {
          const completedOrders = Object.values(orders).filter(o => o.status === "delivered");
          if (completedOrders.length === 0) return bot.sendMessage(id, "Нет выполненных заказов");

          const ordersByCourier = {};
          completedOrders.forEach(o => {
              const c = o.courier_username || "Неизвестно";
              if (!ordersByCourier[c]) ordersByCourier[c] = [];
              ordersByCourier[c].push(o);
          });

          for (const courier in ordersByCourier) {
              await bot.sendMessage(id, `📦 Выполненные заказы курьера @${courier}:`);
              for (const o of ordersByCourier[courier]) {
                  await bot.sendMessage(id, buildOrderMessage(o), { parse_mode: "MarkdownV2" });
              }
          }
      } else {
          const doneOrders = Object.values(orders).filter(o => o.status === "delivered" && o.courier_username === username);
          if (doneOrders.length === 0) return bot.sendMessage(id, "У вас нет выполненных заказов");

          for (const o of doneOrders) {
              await bot.sendMessage(id, buildOrderMessage(o), { parse_mode: "MarkdownV2" });
          }
      }

      return;
  }
});

// ================= Express API =================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ----------------- Отправка заказа -----------------
app.post("/api/send-order", async (req, res) => {
  try {
    const { tgNick, city, delivery, payment, orderText, date, time, tgUser, initData } = req.body;

    if (!tgNick || !orderText) {
      return res.status(400).json({ success: false, error: "Неверные данные" });
    }

    const id = generateOrderId();
    const order = {
      id,
      tgNick,
      city,
      delivery,
      payment,
      orderText,
      date,
      time,
      status: "new",
      created_at: new Date().toISOString(),
      messages: [],
      tgUser: tgUser || null,
      initData: initData || null
    };

    orders[id] = order;
    saveAll();

    // Отправка в Telegram
    await broadcastOrderToStaff(order);

    // Обновление stock для всех WebSocket клиентов
    broadcastStock();

    return res.json({ success: true, orderId: id });
  } catch (err) {
    console.error("Ошибка при обработке /api/send-order:", err);
    return res.status(500).json({ success: false, error: "Внутренняя ошибка сервера" });
  }
});

// ----------------- WebSocket: обновление stock -----------------
function broadcastStock() {
  const data = JSON.stringify({ type: "stock-update", stock });
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(data); } catch (e) { console.error(e); }
    }
  });
}

// ----------------- Отправка заказов в Telegram -----------------
async function broadcastOrderToStaff(order) {
  const recipients = [ADMIN_ID, ...Object.keys(COURIERS)];
  order.messages = [];

  for (const idOrUsername of recipients) {
    try {
      const chatId = typeof idOrUsername === "number" ? idOrUsername : COURIERS[idOrUsername];
      if (!chatId) continue;

      const sent = await bot.sendMessage(chatId, buildOrderMessage(order), {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [[{ text: "📦 Взять заказ", callback_data: `take_${order.id}` }]]
        }
      });

      order.messages.push({ chatId: sent.chat.id, messageId: sent.message_id });
    } catch (e) {
      console.error("Ошибка при отправке в Telegram:", e);
    }
  }

  saveAll();
}

// ================= Start server =================
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
  console.log("Bot started and polling.");
});


