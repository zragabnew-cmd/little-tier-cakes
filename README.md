# Little Tier Cakes

A single-page online cake shop built with plain HTML, CSS and JavaScript. No build step.

## Features
- 12 cakes with category filters and sorting
- Size options (6", 8", 10") with live pricing and an optional icing message
- Cart with quantity controls, saved in the browser
- Delivery checkout with field validation and an order confirmation

This is a demo. Placing an order takes no payment and sends nothing to a bakery.

## Run it
Open `index.html` in a browser, or publish the repo with GitHub Pages (Settings, Pages, main branch).

## Backend (REST API)

The `backend/` folder holds an Express API for the shop. Data lives in memory and resets when the server restarts.

```bash
cd backend
npm install
npm start        # http://localhost:3000/api
```

Endpoints (all under `/api`):

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Products | `GET /products` (filters `category`, `q`, `sort=price_asc\|price_desc\|name`), `GET /products/:id` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me` |
| Carts | `POST /carts`, `GET /carts/:cartId`, `POST /carts/:cartId/items`, `PATCH` and `DELETE /carts/:cartId/items/:itemId`, `POST /carts/:cartId/promo` (code `WELCOME10`) |
| Orders | `POST /orders` (with `cartId` or `items`), `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` |
| Test helpers | `POST /test/reset`, `POST /test/orders/:id/status` (disabled when `NODE_ENV=production`) |

Errors return `{ "error": { "code", "message", "fields" } }` with status 400, 401, 403, 404, 409 or 422.

## Deploy (free, on Render)

`render.yaml` describes one web service that serves the shop and the API together.
In Render choose New, then Blueprint, pick this repo, and apply. The site opens at the service URL, and the API is at `/api`.
Free services sleep after 15 minutes without traffic and data in memory resets on every restart.
