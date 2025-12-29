const mysql = require("mysql2/promise");

let db;

async function initDB() {
  db = await mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQLDATABASE,
    port: parseInt(process.env.MYSQLPORT) || 3306,
  });

  console.log("MySQL connected");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS couriers (
      username VARCHAR(255) PRIMARY KEY,
      chat_id BIGINT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE,
      first_name VARCHAR(255),
      subscribed TINYINT DEFAULT 1,
      city VARCHAR(255),
      created_at DATETIME,
      last_active DATETIME,
      chat_id BIGINT,
      banned TINYINT DEFAULT 0
    )
  `);

  await db.execute(`
  CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(20) PRIMARY KEY,
    tgNick VARCHAR(255),
    city VARCHAR(255),
    delivery VARCHAR(255),
    payment VARCHAR(255),
    orderText TEXT,
    date VARCHAR(50),
    time VARCHAR(50),
    status VARCHAR(20) DEFAULT 'new',
    courier_username VARCHAR(255),
    taken_at DATETIME,
    delivered_at DATETIME,
    created_at DATETIME,
    client_chat_id BIGINT
  )
`);


  await db.execute(`
    CREATE TABLE IF NOT EXISTS stock (
      product VARCHAR(255) PRIMARY KEY,
      amount INT
    )
  `);

  console.log("Tables ready");
}

// Возвращает подключение к базе
function getDB() {
  return db;
}

// ===== Баны =====
async function isBannedByChatId(chatId) {
  const [rows] = await getDB().execute(
    "SELECT banned FROM clients WHERE chat_id=?",
    [chatId]
  );
  return rows.length && rows[0].banned === 1;
}

async function banUserByChatId(chatId) {
  await getDB().execute("UPDATE clients SET banned=1 WHERE chat_id=?", [chatId]);
}

async function unbanUserByChatId(chatId) {
  await getDB().execute("UPDATE clients SET banned=0 WHERE chat_id=?", [chatId]);
}

// ===== Экспортируем всё наружу =====
module.exports = {
  initDB,
  getDB,
  // Баны
  isBannedByChatId,
  banUserByChatId,
  unbanUserByChatId,
  // Другие функции (клиенты, курьеры, заказы и т.д.)
  // addOrUpdateClient,
  // getClient,
  // getAllClients,
  // addCourier,
  // removeCourier,
  // getCouriers,
  // и т.д.
};


// ================= Функции для работы с таблицами =================

// Курьеры
async function isCourier(username) {
  const [rows] = await db.execute("SELECT 1 FROM couriers WHERE username=?", [username]);
  return rows.length > 0;
}

async function isCourierById(chatId) {
  const [rows] = await db.execute("SELECT 1 FROM couriers WHERE chat_id=?", [chatId]);
  return rows.length > 0;
}

async function addCourier(username, chatId) {
  await db.execute(`
    INSERT INTO couriers (username, chat_id)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE chat_id=VALUES(chat_id)
  `, [username, chatId]);
}

async function removeCourier(username) {
  await db.execute("DELETE FROM couriers WHERE username=?", [username]);
}

async function getCouriers() {
  const [rows] = await db.execute("SELECT * FROM couriers");
  const map = {};
  rows.forEach(r => map[r.username] = r.chat_id);
  return map;
}

// Клиенты
async function addOrUpdateClient(username, first_name, chat_id) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' '); // MySQL DATETIME
  await db.execute(`
    INSERT INTO clients (username, first_name, subscribed, created_at, last_active, chat_id)
    VALUES (?, ?, 1, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      first_name=VALUES(first_name),
      last_active=VALUES(last_active),
      chat_id=VALUES(chat_id),
      subscribed=1
  `, [username, first_name, now, now, chat_id]);
}

async function getClient(username) {
  const [rows] = await db.execute("SELECT * FROM clients WHERE username=?", [username]);
  return rows[0] || null;
}

// --- Клиенты: список и баны ---

async function getAllClients() {
  const [rows] = await db.execute("SELECT username, chat_id, banned FROM clients");
  return rows;
}

async function banUser(username) {
  await db.execute("UPDATE clients SET banned=1 WHERE username=?", [username]);
}

async function unbanUser(username) {
  await db.execute("UPDATE clients SET banned=0 WHERE username=?", [username]);
}

async function isBanned(username) {
  const [rows] = await db.execute(
    "SELECT banned FROM clients WHERE username=?",
    [username]
  );
  return rows.length && rows[0].banned === 1;
}



async function addOrder(order) {
  if (!db) throw new Error("DB not initialized");
  if (!order.id || !order.tgNick || !order.orderText) {
    throw new Error("Missing required order fields");
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await db.execute(`
    INSERT INTO orders (id, tgNick, city, delivery, payment, orderText, date, time, status, created_at, client_chat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    order.id, 
    order.tgNick, 
    order.city || null, 
    order.delivery || null, 
    order.payment || null,
    order.orderText, 
    order.date || null, 
    order.time || null, 
    order.status || "new", 
    now,
    order.client_chat_id || null
  ]);

  return order.id;
}


async function getOrderById(id) {
  if (!db) throw new Error("DB not initialized");
  const [rows] = await db.execute("SELECT * FROM orders WHERE id=?", [id]);
  return rows[0] || null;
}

async function getOrders(filter = {}) {
  if (!db) throw new Error("DB not initialized");

  let query = "SELECT * FROM orders WHERE 1=1";
  const params = [];

  if (filter.status) {
    query += " AND status=?";
    params.push(filter.status);
  }
  if (filter.courier_username) {
    query += " AND courier_username=?";
    params.push(filter.courier_username);
  }
  if (filter.client_chat_id) {
    query += " AND client_chat_id=?";
    params.push(filter.client_chat_id);
  }

  const [rows] = await db.execute(query, params);
  return rows;
}


async function updateOrderStatus(id, status, courier_username = null) {
  if (!db) throw new Error("DB not initialized");
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (status === "taken") {
    await db.execute(
      "UPDATE orders SET status=?, courier_username=?, taken_at=? WHERE id=?",
      [status, courier_username, now, id]
    );
  } else if (status === "delivered") {
    await db.execute(
      "UPDATE orders SET status=?, delivered_at=? WHERE id=?",
      [status, now, id]
    );
  } else if (status === "new") {
    await db.execute(
      "UPDATE orders SET status=?, courier_username=NULL, taken_at=NULL WHERE id=?",
      [status, id]
    );
  }
}





// Stock
async function getStock() {
  if (!db) throw new Error("DB not initialized");
  const [rows] = await db.execute("SELECT * FROM stock");
  const s = {};
  rows.forEach(r => s[r.product] = r.amount);
  return s;
}

async function updateStock(product, amount) {
  if (!db) throw new Error("DB not initialized");
  if (!product || typeof amount !== "number") throw new Error("Invalid stock data");
  await db.execute(`
    INSERT INTO stock (product, amount)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE amount=VALUES(amount)
  `, [product, amount]);
}


module.exports = {
  initDB,
  getDB,
  // Курьеры
  isCourier,
  isCourierById,
  addCourier,
  removeCourier,
  getCouriers,
  // Клиенты
  addOrUpdateClient,
  getClient,
  getAllClients,
  banUser,
  unbanUser,
  isBanned,
  // Заказы
  addOrder,
  getOrderById,
  getOrders,
  updateOrderStatus,
  // Баны
  isBannedByChatId,
  banUserByChatId,
  unbanUserByChatId,
};
