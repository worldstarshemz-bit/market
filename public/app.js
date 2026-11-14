const $ = (selector) => document.querySelector(selector);
const grid = $('#productGrid');
const overlay = $('#overlay');
const dialogContent = $('#dialogContent');
const categoriesEl = $('#categories');
let products = [];
let categories = [];
let activeCategory = 'All finds';
let user = null;
let toastTimer;
let cart = JSON.parse(localStorage.getItem('campus-market-cart') || '[]');
let favorites = JSON.parse(localStorage.getItem('campus-market-favorites') || '[]');
const money = (cents) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); };
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function saveCart() { localStorage.setItem('campus-market-cart', JSON.stringify(cart)); updateCartCount(); }
function updateCartCount() { $('#cartCount').textContent = cart.reduce((n, item) => n + item.quantity, 0); }
function openDialog(html) { dialogContent.innerHTML = html; overlay.hidden = false; document.body.style.overflow = 'hidden'; }
function closeDialog() { overlay.hidden = true; document.body.style.overflow = ''; }
function renderCategories() {
  categoriesEl.innerHTML = ['All finds', ...categories].map((c) => `<button class="category-chip ${activeCategory === c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
}
function renderProducts() {
  const query = $('#search').value.trim().toLowerCase();
  const shown = products.filter((p) => (activeCategory === 'All finds' || p.category === activeCategory) && (!query || `${p.title} ${p.description} ${p.category} ${p.sellerName}`.toLowerCase().includes(query)));
  $('#resultCount').textContent = `${shown.length} ${shown.length === 1 ? 'good find' : 'good finds'}`;
  $('#emptyState').hidden = shown.length !== 0;
  grid.hidden = shown.length === 0;
  grid.innerHTML = shown.map((p) => `<article class="product-card"><div class="product-image-wrap">${p.imageUrl ? `<img class="product-image" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;image-fallback&quot;>✳</div>'">` : '<div class="image-fallback">✳</div>'}<span class="product-category">${escapeHtml(p.category)}</span><button class="heart-button ${favorites.includes(p.id) ? 'liked' : ''}" data-favorite="${p.id}" aria-label="Save ${escapeHtml(p.title)}">${favorites.includes(p.id) ? '♥' : '♡'}</button></div><div class="product-info"><div class="product-title-row"><h3 class="product-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</h3><span class="product-price">${money(p.priceCents)}</span></div><p class="product-description">${escapeHtml(p.description)}</p><div class="seller-row"><span class="seller-name"><span>${escapeHtml(p.sellerName.slice(0, 1).toUpperCase())}</span>${escapeHtml(p.sellerName)}</span><button class="add-cart" data-add="${p.id}">＋ Add to bag</button></div></div></article>`).join('');
}
async function loadProducts() {
  try { const data = await api('/api/products'); products = data.products; categories = data.categories; renderCategories(); renderProducts(); }
  catch (e) { $('#resultCount').textContent = e.message; }
}
function updateAccount() {
  $('#loginButton').hidden = !!user;
  $('#avatarButton').hidden = !user;
  $('#ordersButton').hidden = !user;
  if (user) $('#avatarButton').textContent = user.name.slice(0, 1).toUpperCase();
}
function authDialog(mode = 'login') {
  const register = mode === 'register';
  openDialog(`<div class="eyebrow">${register ? 'JOIN YOUR CAMPUS COMMUNITY' : 'WELCOME BACK'}</div><h2 id="dialogTitle">${register ? 'Make it yours.' : 'Good to see you.'}</h2><p class="dialog-intro">${register ? 'Create an account with your campus email to buy and sell nearby.' : 'Sign in with your campus account to keep the good stuff moving.'}</p><form id="authForm">${register ? '<label>Your name<input name="name" autocomplete="name" minlength="2" maxlength="60" required placeholder="Alex Morgan"></label>' : ''}<label>Campus email<input name="email" type="email" autocomplete="email" required placeholder="you@campus.edu"></label><label>Password<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" required placeholder="At least 8 characters"></label><button class="primary-button" type="submit">${register ? 'Create account' : 'Log in'} <span>↗</span></button></form><div class="form-switch">${register ? 'Already part of the market?' : 'New around here?'} <button class="link-button" id="switchAuth">${register ? 'Log in' : 'Create an account'}</button></div>`);
  $('#switchAuth').onclick = () => authDialog(register ? 'login' : 'register');
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    try { const data = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) }); user = data.user; updateAccount(); closeDialog(); toast(`You're in, ${user.name.split(' ')[0]}!`); if (pendingSell) { pendingSell = false; sellDialog(); } }
    catch (err) { toast(err.message); }
  };
}
let pendingSell = false;
function sellDialog() {
  if (!user) { pendingSell = true; authDialog('register'); return; }
  openDialog(`<div class="eyebrow">GIVE YOUR GOOD STUFF A NEW HOME</div><h2 id="dialogTitle">List an item.</h2><p class="dialog-intro">Keep it honest, keep it local. Buyers will arrange a campus meetup with you.</p><form id="sellForm"><label>What are you selling?<input name="title" required minlength="3" maxlength="80" placeholder="e.g. Biology textbook"></label><label>Category<select name="category" required>${categories.map((c) => `<option>${escapeHtml(c)}</option>`).join('')}</select></label><label>Price (USD)<input name="price" type="number" min="0.01" max="100000" step="0.01" required placeholder="12.00"></label><label>How many available?<input name="stock" type="number" min="1" max="100" value="1" required></label><label>Tell buyers about it<textarea name="description" minlength="10" maxlength="1000" required placeholder="Condition, details, pickup info…"></textarea></label><label>Photo link (optional)<input name="imageUrl" type="url" placeholder="https://…"></label><button class="primary-button" type="submit">Publish listing <span>↗</span></button></form>`);
  $('#sellForm').onsubmit = async (e) => {
    e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget));
    try { await api('/api/products', { method: 'POST', body: JSON.stringify(form) }); closeDialog(); await loadProducts(); toast('Your listing is live!'); }
    catch (err) { toast(err.message); }
  };
}
function showCart() {
  const lines = cart.map((line) => ({ ...line, product: products.find((p) => p.id === line.productId) })).filter((line) => line.product);
  if (!lines.length) { openDialog('<div class="eyebrow">YOUR BAG</div><h2 id="dialogTitle">It is looking a little light.</h2><p class="dialog-intro">Add something good from the market and it will show up here.</p><button class="primary-button" id="keepShopping">Keep exploring <span>↗</span></button>'); $('#keepShopping').onclick = closeDialog; return; }
  const total = lines.reduce((n, l) => n + l.product.priceCents * l.quantity, 0);
  openDialog(`<div class="eyebrow">YOUR CAMPUS BAG</div><h2 id="dialogTitle">Good choices.</h2><div>${lines.map((l) => `<div class="cart-line"><div><strong>${escapeHtml(l.product.title)}</strong><small>${money(l.product.priceCents)} · from ${escapeHtml(l.product.sellerName)}</small></div><div class="quantity-controls"><button data-qty="${l.productId}" data-delta="-1" aria-label="Remove one">−</button><span>${l.quantity}</span><button data-qty="${l.productId}" data-delta="1" aria-label="Add one">+</button></div></div>`).join('')}</div><div class="total-row"><span>Estimated total</span><span>${money(total)}</span></div><p class="subtle">No online payment here—coordinate a safe campus pickup and payment with the seller.</p><form id="checkoutForm"><label>Pickup note (optional)<input name="pickupNote" maxlength="240" placeholder="Best time or campus meetup spot"></label><button class="primary-button" type="submit">Place order request <span>↗</span></button></form>`);
  dialogContent.querySelectorAll('[data-qty]').forEach((btn) => btn.onclick = () => { const line = cart.find((l) => l.productId === Number(btn.dataset.qty)); line.quantity += Number(btn.dataset.delta); if (line.quantity < 1) cart = cart.filter((l) => l !== line); saveCart(); showCart(); });
  $('#checkoutForm').onsubmit = async (e) => {
    e.preventDefault(); if (!user) { authDialog('login'); return; }
    try { const pickupNote = new FormData(e.currentTarget).get('pickupNote'); const data = await api('/api/orders', { method: 'POST', body: JSON.stringify({ items: cart, pickupNote }) }); cart = []; saveCart(); closeDialog(); await loadProducts(); toast(`Order request #${data.orderId} placed!`); }
    catch (err) { toast(err.message); }
  };
}
async function showOrders() {
  try { const { orders } = await api('/api/orders'); openDialog(`<div class="eyebrow">YOUR CAMPUS ACTIVITY</div><h2 id="dialogTitle">Your orders.</h2><p class="dialog-intro">Order requests and items you're selling.</p><div class="orders-wrap">${orders.length ? orders.map((o) => `<div class="order-card"><strong>Order #${o.id}</strong><span class="order-status">${escapeHtml(o.status)}</span><small>${new Date(`${o.createdAt.replace(' ', 'T')}Z`).toLocaleDateString()} · ${money(o.totalCents)} · ${o.items.map((i) => `${escapeHtml(i.title)} × ${i.quantity}`).join(', ')}</small>${o.pickupNote ? `<small>Pickup note: ${escapeHtml(o.pickupNote)}</small>` : ''}</div>`).join('') : '<p class="subtle">No orders yet. Find something you love or list something of your own.</p>'}</div>`); }
  catch (e) { toast(e.message); }
}
$('#search').addEventListener('input', renderProducts);
categoriesEl.addEventListener('click', (e) => { const button = e.target.closest('[data-category]'); if (button) { activeCategory = button.dataset.category; renderCategories(); renderProducts(); } });
grid.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { const id = Number(add.dataset.add); const line = cart.find((l) => l.productId === id); if (line) line.quantity++; else cart.push({ productId: id, quantity: 1 }); saveCart(); toast('Added to your bag'); }
  const favorite = e.target.closest('[data-favorite]');
  if (favorite) { const id = Number(favorite.dataset.favorite); favorites = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id]; localStorage.setItem('campus-market-favorites', JSON.stringify(favorites)); renderProducts(); }
});
$('#sellButton').onclick = sellDialog;
$('#sellButtonSecondary').onclick = sellDialog;
$('#bannerSellButton').onclick = sellDialog;
$('#emptySellButton').onclick = sellDialog;
$('#cartButton').onclick = showCart;
$('#loginButton').onclick = () => authDialog('login');
$('#avatarButton').onclick = async () => { if (confirm('Sign out of Campus Market?')) { await api('/api/auth/logout', { method: 'POST', body: '{}' }); user = null; updateAccount(); toast('Signed out'); } };
$('#ordersButton').onclick = showOrders;
$('#exploreButton').onclick = () => $('#market').scrollIntoView({ behavior: 'smooth' });
$('#dialogClose').onclick = closeDialog;
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); } });
(async () => { updateCartCount(); try { const data = await api('/api/me'); user = data.user; updateAccount(); } catch { } await loadProducts(); })();
