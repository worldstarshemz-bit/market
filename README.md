# Campus Market

A campus-only, student-to-student marketplace MVP. Students can browse listings, register with a campus email, list items, add items to a local shopping bag, and create pickup order requests. It is intentionally designed for one campus rather than a general Jumia-style marketplace.

## Run locally

Requirements: Node.js 20+ and npm. `better-sqlite3` may need a C/C++ build toolchain on systems without a prebuilt binary.

1. Copy `.env.example` to `.env` and set `CAMPUS_EMAIL_DOMAIN` to your school's email domain (for example, `students.example.edu`). Set `SESSION_SECRET` to a long random secret before deploying.
2. Install dependencies: `npm install`
3. Start the server: `npm start` (or `npm run dev` for automatic restart).
4. Open http://localhost:3000.

The SQLite database and session store are created automatically. The market seeds a handful of sample products on first run. Seed listings are display-only and do not have a usable seller login.

## Features

- Responsive storefront with product search, category filters, product cards, favorites, and a bag.
- Campus-domain account registration and sign-in; passwords are hashed with bcrypt.
- Seller listing creation and ownership-checked delisting.
- Server-side price/stock validation and transactional order requests.
- Order history and pickup notes. No payment is collected; buyer and seller coordinate payment and a safe campus meetup themselves.
- SQLite persistence, HTTP-only SameSite session cookies, security headers, basic request validation, and prepared SQL statements.

## Important before real deployment

This is a functional MVP, not a fully production-hardened commerce service. Email-domain matching does **not** prove that an account belongs to a student; add email verification (and ideally campus SSO) before trusting access control. Configure HTTPS, a strong `SESSION_SECRET`, backups, rate limiting, operational monitoring, privacy/terms/returns policies, and a real managed database/session store before public launch. Decide how to handle moderation, disputes, prohibited items, seller contact, and personal safety. Payment processing, refunds, delivery, seller payouts, and admin moderation are not included. Sample product imagery comes from Unsplash URLs and should be replaced with images you have permission to use.

## Configuration

- `PORT` (default `3000`)
- `NODE_ENV` (`production` enables secure cookies and requires a strong session secret)
- `SESSION_SECRET`
- `CAMPUS_EMAIL_DOMAIN` (default `campus.edu`; set to the actual campus domain)
- `DB_PATH` (optional database file path)
