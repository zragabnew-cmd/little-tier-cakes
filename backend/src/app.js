"use strict";
const express = require("express");
const S = require("./store");

const TIME_SLOTS = ["10:00 to 12:00", "12:00 to 14:00", "14:00 to 16:00", "16:00 to 18:00"];
const PAYMENTS = ["cash", "card"];
const STATUSES = ["placed", "baking", "out_for_delivery", "delivered", "cancelled"];
const SORTS = ["price_asc", "price_desc", "name"];

function fail(res, status, code, message, fields) {
  const error = { code, message };
  if (fields) error.fields = fields;
  return res.status(status).json({ error });
}

function toApi(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.desc,
    ingredients: p.notes,
    categories: p.cat,
    basePrice: p.price,
    sizes: S.SIZES.map((z) => ({ size: z.size, serves: z.serves, price: S.unitPrice(p, z.size) })),
    art: { color: p.c, layers: p.layers, frosting: p.f, topping: p.top, drip: p.drip || null, candle: !!p.candle, flat: !!p.flat }
  };
}

function tomorrowISO() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}
function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

function validateItem(body) {
  const fields = {};
  const product = typeof body.productId === "string" ? S.productById(body.productId) : null;
  if (!product) fields.productId = "Unknown product.";
  if (!S.SIZES.some((z) => z.size === body.size)) fields.size = 'Size must be one of: ' + S.SIZES.map((z) => z.size).join(", ") + ".";
  const qty = body.quantity === undefined ? 1 : body.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > S.MAX_QTY) fields.quantity = "Quantity must be a whole number from 1 to " + S.MAX_QTY + ".";
  const message = body.message === undefined || body.message === null ? "" : body.message;
  if (typeof message !== "string" || message.trim().length > S.MAX_MESSAGE) fields.message = "Message must be text of at most " + S.MAX_MESSAGE + " characters.";
  if (Object.keys(fields).length) return { fields };
  return { item: { productId: body.productId, size: body.size, message: message.trim(), quantity: qty } };
}

function validateCustomer(c) {
  const fields = {};
  c = c && typeof c === "object" ? c : {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  if (str(c.name).length < 2) fields["customer.name"] = "Enter the customer's full name.";
  if (!/^[+\d][\d\s\-()]{6,}$/.test(str(c.phone))) fields["customer.phone"] = "Enter a valid phone number.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(c.email))) fields["customer.email"] = "Enter a valid email address.";
  if (str(c.address).length < 10) fields["customer.address"] = "Enter the full street address, at least 10 characters.";
  return { fields, customer: { name: str(c.name), phone: str(c.phone), email: str(c.email), address: str(c.address) } };
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  const auth = (req, res, next) => {
    const h = req.get("Authorization") || "";
    const m = /^Bearer (.+)$/.exec(h);
    const userId = m && S.db.tokens.get(m[1]);
    req.user = userId ? S.db.users.get(userId) : null;
    req.tokenValue = m ? m[1] : null;
    next();
  };
  const requireAuth = (req, res, next) =>
    req.user ? next() : fail(res, 401, "UNAUTHENTICATED", "Sign in to use this endpoint. Send an Authorization: Bearer <token> header.");
  app.use(auth);

  /* ---- Site ---- */
  app.get("/", (req, res) => res.json({ name: "Little Tier Cakes API", health: "/api/health", products: "/api/products", docs: "openapi.yaml" }));

  /* ---- Health ---- */
  app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

  /* ---- Products ---- */
  app.get("/api/products", (req, res) => {
    const { category, q, sort } = req.query;
    if (sort !== undefined && !SORTS.includes(sort)) return fail(res, 400, "INVALID_QUERY", "sort must be one of: " + SORTS.join(", ") + ".");
    let list = S.PRODUCTS.slice();
    if (category) {
      list = list.filter((p) => p.cat.some((c) => c.toLowerCase() === String(category).toLowerCase()));
    }
    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter((p) => (p.name + " " + p.desc).toLowerCase().includes(needle));
    }
    if (sort === "price_asc") list.sort((a, b) => a.price - b.price);
    if (sort === "price_desc") list.sort((a, b) => b.price - a.price);
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ count: list.length, products: list.map(toApi) });
  });
  app.get("/api/products/:id", (req, res) => {
    const p = S.productById(req.params.id);
    if (!p) return fail(res, 404, "PRODUCT_NOT_FOUND", "No cake with id '" + req.params.id + "'.");
    res.json(toApi(p));
  });

  /* ---- Auth ---- */
  app.post("/api/auth/register", (req, res) => {
    const b = req.body || {};
    const fields = {};
    if (typeof b.name !== "string" || b.name.trim().length < 2) fields.name = "Enter your full name.";
    if (typeof b.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email.trim())) fields.email = "Enter a valid email address.";
    if (typeof b.password !== "string" || b.password.length < 8) fields.password = "Password must be at least 8 characters.";
    if (Object.keys(fields).length) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", fields);
    const email = b.email.trim().toLowerCase();
    if ([...S.db.users.values()].some((u) => u.email === email)) return fail(res, 409, "EMAIL_TAKEN", "An account with this email already exists.");
    const salt = S.uid("salt");
    const user = { id: S.uid("usr"), name: b.name.trim(), email, salt, passwordHash: S.hash(b.password, salt) };
    S.db.users.set(user.id, user);
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
  });
  app.post("/api/auth/login", (req, res) => {
    const b = req.body || {};
    const user = typeof b.email === "string" && [...S.db.users.values()].find((u) => u.email === b.email.trim().toLowerCase());
    if (!user || typeof b.password !== "string" || S.hash(b.password, user.salt) !== user.passwordHash) {
      return fail(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    const token = S.uid("tok");
    S.db.tokens.set(token, user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  });
  app.post("/api/auth/logout", requireAuth, (req, res) => {
    S.db.tokens.delete(req.tokenValue);
    res.sendStatus(204);
  });
  app.get("/api/me", requireAuth, (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email }));

  /* ---- Carts ---- */
  const getCart = (req, res) => {
    const cart = S.db.carts.get(req.params.cartId);
    if (!cart) { fail(res, 404, "CART_NOT_FOUND", "No cart with id '" + req.params.cartId + "'."); return null; }
    return cart;
  };
  app.post("/api/carts", (req, res) => {
    const cart = { id: S.uid("cart"), items: [], promoCode: null };
    S.db.carts.set(cart.id, cart);
    res.status(201).json(S.publicCart(cart));
  });
  app.get("/api/carts/:cartId", (req, res) => {
    const cart = getCart(req, res);
    if (cart) res.json(S.publicCart(cart));
  });
  app.post("/api/carts/:cartId/items", (req, res) => {
    const cart = getCart(req, res);
    if (!cart) return;
    const v = validateItem(req.body || {});
    if (v.fields) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", v.fields);
    const same = cart.items.find((i) => i.productId === v.item.productId && i.size === v.item.size && i.message === v.item.message);
    if (same) {
      if (same.quantity + v.item.quantity > S.MAX_QTY) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", { quantity: "A cart line can hold at most " + S.MAX_QTY + " cakes." });
      same.quantity += v.item.quantity;
    } else {
      cart.items.push({ id: S.uid("itm"), ...v.item });
    }
    res.status(201).json(S.publicCart(cart));
  });
  app.patch("/api/carts/:cartId/items/:itemId", (req, res) => {
    const cart = getCart(req, res);
    if (!cart) return;
    const item = cart.items.find((i) => i.id === req.params.itemId);
    if (!item) return fail(res, 404, "ITEM_NOT_FOUND", "No item with id '" + req.params.itemId + "' in this cart.");
    const q = (req.body || {}).quantity;
    if (!Number.isInteger(q) || q < 1 || q > S.MAX_QTY) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", { quantity: "Quantity must be a whole number from 1 to " + S.MAX_QTY + "." });
    item.quantity = q;
    res.json(S.publicCart(cart));
  });
  app.delete("/api/carts/:cartId/items/:itemId", (req, res) => {
    const cart = getCart(req, res);
    if (!cart) return;
    const idx = cart.items.findIndex((i) => i.id === req.params.itemId);
    if (idx < 0) return fail(res, 404, "ITEM_NOT_FOUND", "No item with id '" + req.params.itemId + "' in this cart.");
    cart.items.splice(idx, 1);
    res.json(S.publicCart(cart));
  });
  app.post("/api/carts/:cartId/promo", (req, res) => {
    const cart = getCart(req, res);
    if (!cart) return;
    const code = typeof (req.body || {}).code === "string" ? req.body.code.trim().toUpperCase() : "";
    if (!S.PROMOS[code]) return fail(res, 422, "INVALID_PROMO", "This promo code is not valid.");
    cart.promoCode = code;
    res.json(S.publicCart(cart));
  });

  /* ---- Orders ---- */
  app.post("/api/orders", (req, res) => {
    const b = req.body || {};
    const fields = {};
    let cart;
    if (b.cartId !== undefined) {
      cart = S.db.carts.get(b.cartId);
      if (!cart) return fail(res, 404, "CART_NOT_FOUND", "No cart with id '" + b.cartId + "'.");
    } else if (Array.isArray(b.items)) {
      cart = { id: null, items: [], promoCode: null };
      b.items.forEach((it, n) => {
        const v = validateItem(it || {});
        if (v.fields) Object.entries(v.fields).forEach(([k, m]) => (fields["items[" + n + "]." + k] = m));
        else cart.items.push({ id: "tmp" + n, ...v.item });
      });
      if (b.promoCode !== undefined) {
        const code = String(b.promoCode).trim().toUpperCase();
        if (!S.PROMOS[code]) fields.promoCode = "This promo code is not valid.";
        else cart.promoCode = code;
      }
    } else {
      return fail(res, 422, "VALIDATION_ERROR", "Send either cartId or items.", { cartId: "cartId or items is required." });
    }

    const c = validateCustomer(b.customer);
    Object.assign(fields, c.fields);
    if (!isRealDate(b.deliveryDate)) fields.deliveryDate = "Enter a date as YYYY-MM-DD.";
    else if (b.deliveryDate < tomorrowISO()) fields.deliveryDate = "Choose tomorrow or a later date.";
    if (!TIME_SLOTS.includes(b.timeSlot)) fields.timeSlot = "Time slot must be one of: " + TIME_SLOTS.join(", ") + ".";
    if (!PAYMENTS.includes(b.payment)) fields.payment = "Payment must be one of: " + PAYMENTS.join(", ") + ".";
    if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 200)) fields.note = "Note must be text of at most 200 characters.";
    if (Object.keys(fields).length) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", fields);
    if (cart.items.length === 0) return fail(res, 422, "EMPTY_CART", "The cart is empty. Add a cake before placing an order.");

    const priced = S.priceCart(cart);
    const seq = ++S.db.orderSeq;
    const order = {
      id: S.uid("ord"),
      number: "LT-" + seq,
      status: "placed",
      userId: req.user ? req.user.id : null,
      createdAt: new Date().toISOString(),
      customer: c.customer,
      deliveryDate: b.deliveryDate,
      timeSlot: b.timeSlot,
      payment: b.payment,
      note: b.note || "",
      ...priced
    };
    S.db.orders.set(order.id, order);
    if (cart.id) S.db.carts.delete(cart.id);
    res.status(201).json(order);
  });
  app.get("/api/orders", requireAuth, (req, res) => {
    const list = [...S.db.orders.values()].filter((o) => o.userId === req.user.id);
    res.json({ count: list.length, orders: list });
  });
  app.get("/api/orders/:id", (req, res) => {
    const o = S.db.orders.get(req.params.id) || [...S.db.orders.values()].find((x) => x.number === req.params.id);
    if (!o) return fail(res, 404, "ORDER_NOT_FOUND", "No order with id '" + req.params.id + "'.");
    if (o.userId && (!req.user || req.user.id !== o.userId)) return fail(res, 403, "FORBIDDEN", "This order belongs to another account.");
    res.json(o);
  });
  app.post("/api/orders/:id/cancel", (req, res) => {
    const o = S.db.orders.get(req.params.id);
    if (!o) return fail(res, 404, "ORDER_NOT_FOUND", "No order with id '" + req.params.id + "'.");
    if (o.userId && (!req.user || req.user.id !== o.userId)) return fail(res, 403, "FORBIDDEN", "This order belongs to another account.");
    if (o.status !== "placed") return fail(res, 409, "CANNOT_CANCEL", "Only orders with status 'placed' can be cancelled. This order is '" + o.status + "'.");
    o.status = "cancelled";
    res.json(o);
  });

  /* ---- Test helpers (off when NODE_ENV=production unless ENABLE_TEST_ROUTES=1) ---- */
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_TEST_ROUTES === "1") {
    app.post("/api/test/reset", (req, res) => { S.reset(); res.json({ status: "reset" }); });
    app.post("/api/test/orders/:id/status", (req, res) => {
      const o = S.db.orders.get(req.params.id);
      if (!o) return fail(res, 404, "ORDER_NOT_FOUND", "No order with id '" + req.params.id + "'.");
      const s = (req.body || {}).status;
      if (!STATUSES.includes(s)) return fail(res, 422, "VALIDATION_ERROR", "Some fields are not valid.", { status: "Status must be one of: " + STATUSES.join(", ") + "." });
      o.status = s;
      res.json(o);
    });
  }

  app.use("/api", (req, res) => fail(res, 404, "NOT_FOUND", "No endpoint " + req.method + " " + req.originalUrl + "."));
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return fail(res, 400, "INVALID_JSON", "The request body is not valid JSON.");
    console.error(err);
    fail(res, 500, "SERVER_ERROR", "Something went wrong on our side.");
  });
  return app;
}

module.exports = { createApp };
