# EDESK STATIONERY — Digital Business Manager

A complete, installable web app (PWA) for running a stationery shop:
stock & services, daily sales (mauzo), expenses, damaged/wasted stock,
staff accounts, and professional day/week/month/year reports.

## Folder structure (kept separate, as required)

```
edesk-stationery/
├── Frontend/     → HTML, CSS, JS only (what the browser/PWA runs)
├── Backend/      → PHP only (the API + installer)
└── Database/     → the MySQL schema (edesk_stationery.sql)
```

The Frontend is a static app that talks to the Backend purely through
JSON API calls (fetch). Nothing is mixed between the three folders.

## 1. Requirements

- A web server with PHP 7.4+ (Apache/Nginx/XAMPP/LAMP/etc.)
- MySQL or MariaDB
- PDO MySQL extension enabled (enabled by default in most PHP setups)

## 2. Installation

1. Upload/copy the whole `edesk-stationery` folder (all three subfolders
   together) to your web server, e.g. `htdocs/edesk-stationery/`.
2. In your browser, open:
   `http://yourdomain-or-localhost/edesk-stationery/Backend/install.php`
3. Fill in your database details (host, database name, username,
   password) — the installer will create the database and all tables
   for you automatically from `Database/edesk_stationery.sql`.
4. Fill in your business name and create the **first Administrator
   account** (name, username, password, and a security question used
   for password recovery).
5. Click **Install System**. You're done.
6. Go to `Frontend/index.html` (or click the link shown) to open the
   website, then log in with the admin account you just created.

> ⚠️ `install.php` locks itself after a successful install. To reinstall,
> delete `Backend/config.php` and run it again.

## 3. Installing it as an app (PWA)

Once the site is open in Chrome/Edge/Safari, users can install it like
a real app:
- **Desktop:** click the install icon in the browser address bar, or
  the "Install App" button on the homepage.
- **Mobile:** use "Add to Home Screen" from the browser menu, or tap
  "Install App" on the homepage.

It will then open in its own window/icon, and the interface (shell)
still loads even with a weak connection, thanks to the built-in
service worker. Live data (sales, stock, reports) always needs an
internet/network connection to your server.

## 4. Roles

- **Admin** — full access: manage stock/services, sales, expenses,
  damages, reports, and can create other Admins or Workers.
- **Worker** — can only record **Sales** and **Expenses**, and view
  reports/stock. Cannot manage products, damages, or users.

Every user (Admin or Worker) can open **My Profile** to change their
own name, password, and security question at any time.

## 5. Reports

The Reports page lets any user generate a report for:
- **Day** — pick the exact date.
- **Week** — pick the starting date; the system automatically covers
  the next 7 days.
- **Month** — pick any date inside the target month.
- **Year** — pick any date inside the target year.
- **Custom Range** — pick a start and end date.

Every report shows: total sales, transactions, gross/net profit,
expenses, damage loss, **top-selling products/services**, and
**most profitable products/services** — plus a full expense and
damage breakdown. Reports can be **downloaded as CSV** (opens
perfectly in Excel) or **printed / saved as PDF** using the browser's
print dialog (already styled for print).

The same "Download" button pattern appears on every page (Stock,
Sales, Expenses, Damages, Users) so records can be exported anytime.

## 6. Notes

- Currency is labeled `TZS` in the interface — this is just a display
  label inside `Frontend/js/ui.js` (the `money()` function) and can be
  changed to any currency symbol you prefer.
- The landing page's "Report of the Day" card shows shop-wide totals
  only (no customer names or line items) so it is safe to display
  before login.
- All passwords are stored using PHP's secure `password_hash()` —
  never in plain text.
