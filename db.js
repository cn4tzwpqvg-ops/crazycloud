const Database = require("better-sqlite3");
const path = require("path");

// Путь к базе данных
const db = new Database(path.join(__dirname, "data", "database.db"));

// ================= Таблицы =================

// Курьеры
db.exec(`
CREATE TABLE IF NOT EXISTS couriers (
  username TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL
);
`);

// Клиенты
db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  first_name TEXT,
  subscribed INTEGER DEFAULT 1,
  city TEXT,
  created_at TEXT,
  last_active TEXT
);
`);

// Заказы
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tgNick TEXT,
  city TEXT,
  delivery TEXT,
  payment TEXT,
  orderText TEXT,
  date TEXT,
  time TEXT,
  status TEXT DEFAULT 'new',
  courier_username TEXT,
  taken_at TEXT,
  delivered_at TEXT,
  created_at TEXT
);
`);

// Склад (stock)
db.exec(`
CREATE TABLE IF NOT EXISTS stock (
  product TEXT PRIMARY KEY,
  amount INTEGER
);
`);

// ================= Функции для работы с таблицами =================

// ---------- Курьеры ----------
function isCourier(username) {
    const row = db.prepare("SELECT 1 FROM couriers WHERE username=?").get(username);
    return !!row;
}

function isCourierById(chatId) {
    const row = db.prepare("SELECT 1 FROM couriers WHERE chat_id=?").get(chatId);
    return !!row;
}

function addCourier(username, chatId) {
    db.prepare(`
        INSERT OR REPLACE INTO couriers (username, chat_id)
        VALUES (?, ?)
    `).run(username, chatId);
}

function removeCourier(username) {
    db.prepare("DELETE FROM couriers WHERE username=?").run(username);
}

function getCouriers() {
    const rows = db.prepare("SELECT * FROM couriers").all();
    const map = {};
    rows.forEach(r => map[r.username] = r.chat_id);
    return map;
}

// ---------- Клиенты ----------
function addOrUpdateClient(username, first_name) {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO clients (username, first_name, subscribed, created_at, last_active)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
            first_name=excluded.first_name,
            last_active=excluded.last_active,
            subscribed=1
    `).run(username, first_name, now, now);
}

function getClient(username) {
    return db.prepare("SELECT * FROM clients WHERE username=?").get(username);
}

// ---------- Заказы ----------
function addOrder(order) {
    db.prepare(`
        INSERT INTO orders (id, tgNick, city, delivery, payment, orderText, date, time, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        order.id, order.tgNick, order.city, order.delivery, order.payment,
        order.orderText, order.date, order.time, order.status || "new", new Date().toISOString()
    );
}

function getOrderById(id) {
    return db.prepare("SELECT * FROM orders WHERE id=?").get(id);
}

function getOrders(filter = {}) {
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
    return db.prepare(query).all(...params);
}

function updateOrderStatus(id, status, courier_username = null) {
    const now = new Date().toISOString();
    if (status === "taken") {
        db.prepare("UPDATE orders SET status=?, courier_username=?, taken_at=? WHERE id=?")
          .run(status, courier_username, now, id);
    } else if (status === "delivered") {
        db.prepare("UPDATE orders SET status=?, delivered_at=? WHERE id=?")
          .run(status, now, id);
    } else if (status === "new") {
        db.prepare("UPDATE orders SET status=?, courier_username=NULL, taken_at=NULL WHERE id=?")
          .run(status, id);
    }
}

// ---------- Stock ----------
function getStock() {
    const rows = db.prepare("SELECT * FROM stock").all();
    const s = {};
    rows.forEach(r => s[r.product] = r.amount);
    return s;
}

function updateStock(product, amount) {
    db.prepare(`
        INSERT INTO stock (product, amount)
        VALUES (?, ?)
        ON CONFLICT(product) DO UPDATE SET amount=excluded.amount
    `).run(product, amount);
}

// ================= Экспорт =================
module.exports = {
    db,
    // Курьеры
    isCourier,
    isCourierById,
    addCourier,
    removeCourier,
    getCouriers,
    // Клиенты
    addOrUpdateClient,
    getClient,
    // Заказы
    addOrder,
    getOrderById,
    getOrders,
    updateOrderStatus,
    // Stock
    getStock,
    updateStock
};
