const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const campusDomain = (process.env.CAMPUS_EMAIL_DOMAIN || 'campus.edu').trim().toLowerCase().replace(/^@/, '');
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in production.');
}
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'market.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 1 CHECK(stock >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    pickup_note TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price_cents INTEGER NOT NULL
  );
`);

const categories = ['Books & Notes', 'Electronics', 'Fashion', 'Room & Living', 'Food & Snacks', 'Other'];
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (!count) {
  const seedUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run('Campus Finds', 'market@campus.edu', 'seed-account-no-login');
  const insert = db.prepare('INSERT INTO products (seller_id, title, description, category, price_cents, image_url, stock) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const samples = [
    ['Calculus: Early Transcendentals', 'Gently used textbook. Notes are clean and all pages are intact.', 'Books & Notes', 2800, 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=900&q=85', 2],
    ['Wireless headphones', 'Great sound for study sessions. Includes charging cable.', 'Electronics', 4200, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85', 1],
    ['Desk lamp', 'Warm LED light with adjustable neck. Perfect for a dorm desk.', 'Room & Living', 1600, 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85', 1],
    ['Canvas backpack', 'Roomy everyday backpack with a laptop sleeve.', 'Fashion', 3200, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85', 1],
    ['Intro to Psychology notes', 'Organized lecture notes for the full semester. Digital copy available after meetup.', 'Books & Notes', 500, 'https://images.unsplash.com/photo-1455390582262-044c marble?auto=format&fit=crop&w=900&q=85', 3]
  ];
  for (const p of samples) insert.run(seedUser.lastInsertRowid, ...p);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '30kb' }));
app.use(session({
  store: new SQLiteStoreFactory({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-before-deploy',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'https:', 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: isProduction ? [] : null
} } }));
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
    const origin = req.get('origin');
    const host = req.get('host');
    if (!host || new URL(origin).host !== host) return res.status(403).json({ error: 'Request origin was not allowed.' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });
const requireUser = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const productSelect = `SELECT p.id, p.title, p.description, p.category, p.price_cents AS priceCents, p.image_url AS imageUrl, p.stock, p.created_at AS createdAt, u.name AS sellerName, p.seller_id AS sellerId FROM products p JOIN users u ON u.id = p.seller_id`;

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = clean(req.body.name, 60);
    const email = clean(req.body.email, 160).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (name.length < 2 || !validEmail(email) || !email.endsWith(`@${campusDomain}`) || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: `Use your @${campusDomain} email, a name of at least 2 characters, and a password between 8 and 128 characters.` });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.status(201).json({ user: { id: Number(result.lastInsertRowid), name, email } });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That email already has an account. Try signing in.' });
    next(e);
  }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = clean(req.body.email, 160).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json({ user: publicUser(user) });
    });
  } catch (e) { next(e); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/products', (req, res) => {
  const q = clean(req.query.q, 100);
  const category = clean(req.query.category, 40);
  const rows = db.prepare(`${productSelect} WHERE p.active = 1 AND p.stock > 0 AND (? = '' OR p.category = ?) AND (? = '' OR p.title LIKE ? OR p.description LIKE ?) ORDER BY p.created_at DESC, p.id DESC LIMIT 100`)
    .all(category, category, q, `%${q}%`, `%${q}%`);
  res.json({ products: rows, categories });
});
app.post('/api/products', requireUser, (req, res) => {
  const title = clean(req.body.title, 80);
  const description = clean(req.body.description, 1000);
  const category = clean(req.body.category, 40);
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);
  const imageUrl = clean(req.body.imageUrl, 500);
  if (title.length < 3 || description.length < 10 || !categories.includes(category) || !Number.isFinite(price) || price <= 0 || price > 100000 || !Number.isInteger(stock) || stock < 1 || stock > 100 || (imageUrl && !/^https:\/\//i.test(imageUrl))) {
    return res.status(400).json({ error: 'Check the listing details. Add a title, description, category, valid price, stock quantity, and an HTTPS image link if you use one.' });
  }
  const result = db.prepare('INSERT INTO products (seller_id, title, description, category, price_cents, image_url, stock) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.session.userId, title, description, category, Math.round(price * 100), imageUrl, stock);
  res.status(201).json({ product: db.prepare(`${productSelect} WHERE p.id = ?`).get(result.lastInsertRowid) });
});
app.delete('/api/products/:id', requireUser, (req, res) => {
  const result = db.prepare('UPDATE products SET active = 0 WHERE id = ? AND seller_id = ?').run(Number(req.params.id), req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'Listing not found or you do not own it.' });
  res.json({ ok: true });
});

const createOrder = db.transaction((buyerId, pickupNote, items) => {
  const normalized = new Map();
  for (const item of items) {
    const id = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new Error('Invalid item or quantity.');
    normalized.set(id, (normalized.get(id) || 0) + quantity);
  }
  if (!normalized.size || normalized.size > 30) throw new Error('Your cart is empty or has too many different products.');
  let total = 0;
  const lines = [];
  const getProduct = db.prepare('SELECT id, seller_id, price_cents, stock, title FROM products WHERE id = ? AND active = 1');
  for (const [id, quantity] of normalized) {
    const product = getProduct.get(id);
    if (!product || product.stock < quantity) throw new Error(`Not enough stock for ${product ? product.title : 'one of your items'}.`);
    if (product.seller_id === buyerId) throw new Error('You cannot order your own listing.');
    total += product.price_cents * quantity;
    lines.push({ ...product, quantity });
  }
  const order = db.prepare('INSERT INTO orders (buyer_id, pickup_note, total_cents) VALUES (?, ?, ?)').run(buyerId, pickupNote, total);
  const insertLine = db.prepare('INSERT INTO order_items (order_id, product_id, seller_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)');
  const deduct = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const line of lines) { insertLine.run(order.lastInsertRowid, line.id, line.seller_id, line.quantity, line.price_cents); deduct.run(line.quantity, line.id); }
  return Number(order.lastInsertRowid);
});
app.post('/api/orders', requireUser, (req, res) => {
  try {
    if (!Array.isArray(req.body.items)) return res.status(400).json({ error: 'Your cart is empty.' });
    const pickupNote = clean(req.body.pickupNote, 240);
    const orderId = createOrder(req.session.userId, pickupNote, req.body.items);
    res.status(201).json({ orderId });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/orders', requireUser, (req, res) => {
  const rows = db.prepare(`SELECT o.id AS orderId, o.status, o.created_at AS createdAt, o.pickup_note AS pickupNote,
    o.total_cents AS orderTotalCents, b.name AS buyerName, oi.quantity, oi.unit_price_cents AS unitPriceCents,
    p.title, oi.seller_id AS sellerId, p.seller_id AS currentSellerId
    FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
    JOIN users b ON b.id = o.buyer_id WHERE o.buyer_id = ? OR oi.seller_id = ? ORDER BY o.id DESC LIMIT 100`)
    .all(req.session.userId, req.session.userId);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.orderId)) map.set(row.orderId, { id: row.orderId, status: row.status, createdAt: row.createdAt, pickupNote: row.pickupNote, totalCents: row.orderTotalCents, buyerName: row.buyerName, items: [] });
    map.get(row.orderId).items.push({ title: row.title, quantity: row.quantity, unitPriceCents: row.unitPriceCents, isSale: row.sellerId === req.session.userId && row.buyerName !== '' });
  }
  res.json({ orders: [...map.values()] });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => console.log(`Campus Market running at http://localhost:${port} (email domain: ${campusDomain})`));
