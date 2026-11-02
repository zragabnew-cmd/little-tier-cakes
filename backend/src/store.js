"use strict";
const crypto = require("crypto");
const PRODUCTS = require("./products.json");

const SIZES = [
  { size: '6"', serves: "6 to 8", multiplier: 1 },
  { size: '8"', serves: "10 to 14", multiplier: 1.6 },
  { size: '10"', serves: "16 to 22", multiplier: 2.3 }
];
const FREE_DELIVERY_OVER = 60;
const DELIVERY_FEE = 6;
const PROMOS = { WELCOME10: 0.1 };
const MAX_QTY = 20;
const MAX_MESSAGE = 30;

const db = { users: new Map(), tokens: new Map(), carts: new Map(), orders: new Map(), orderSeq: 10000 };

function reset() {
  db.users.clear();
  db.tokens.clear();
  db.carts.clear();
  db.orders.clear();
  db.orderSeq = 10000;
}

const uid = (prefix) => prefix + "_" + crypto.randomBytes(6).toString("hex");
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");

function productById(id) {
  return PRODUCTS.find((p) => p.id === id);
}
function unitPrice(product, size) {
  const s = SIZES.find((z) => z.size === size);
  return s ? Math.round(product.price * s.multiplier) : null;
}

function priceCart(cart) {
  const lines = cart.items.map((i) => {
    const p = productById(i.productId);
    const unit = unitPrice(p, i.size);
    return {
      id: i.id,
      productId: i.productId,
      name: p.name,
      size: i.size,
      message: i.message,
      quantity: i.quantity,
      unitPrice: unit,
      lineTotal: unit * i.quantity
    };
  });
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  const rate = cart.promoCode ? PROMOS[cart.promoCode] : 0;
  const discount = Math.round(subtotal * rate * 100) / 100;
  const after = subtotal - discount;
  const deliveryFee = lines.length === 0 || after >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  return {
    items: lines,
    promoCode: cart.promoCode || null,
    subtotal,
    discount,
    deliveryFee,
    total: Math.round((after + deliveryFee) * 100) / 100
  };
}

function publicCart(cart) {
  return { id: cart.id, ...priceCart(cart) };
}

module.exports = {
  PRODUCTS, SIZES, PROMOS, FREE_DELIVERY_OVER, DELIVERY_FEE, MAX_QTY, MAX_MESSAGE,
  db, reset, uid, hash, productById, unitPrice, priceCart, publicCart
};
