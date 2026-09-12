
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- Table: users
-- Admins and Workers. First admin is created by install.php
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(120) NOT NULL,
  `username` VARCHAR(60) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','worker') NOT NULL DEFAULT 'worker',
  `security_question` VARCHAR(255) NOT NULL,
  `security_answer_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: categories
-- Simple category grouping for products/services
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cat_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: products
-- Both stock products AND services are stored here.
-- Services simply have stock tracking disabled (is_service=1).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `category_id` INT UNSIGNED NULL,
  `is_service` TINYINT(1) NOT NULL DEFAULT 0,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'pcs',
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `selling_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `minimum_price` DECIMAL(12,2) NULL DEFAULT NULL,
  `stock_quantity` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `reorder_level` DECIMAL(12,2) NOT NULL DEFAULT 5.00,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_prod_category` (`category_id`),
  CONSTRAINT `fk_prod_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: sales  (Mauzo)
-- One row per line item sold
-- ---------------------------------------------------------
-- ---------------------------------------------------------
-- Table: customers
-- One row per real customer, matched by phone when given, otherwise
-- by name. A sale with neither name nor phone creates no customer row.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NULL,
  `phone` VARCHAR(30) NULL,
  `status` ENUM('active','restricted') NOT NULL DEFAULT 'active',
  `restricted_at` DATETIME NULL DEFAULT NULL,
  `restricted_reason` VARCHAR(255) NULL DEFAULT NULL,
  `restriction_overridden_by` INT UNSIGNED NULL DEFAULT NULL,
  `first_purchase_date` DATE NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_customer_phone` (`phone`),
  KEY `idx_customer_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: sale_transactions
-- One row per checkout/receipt (the customer, payment method, and
-- grand total). A transaction has one or more sale_items.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NULL DEFAULT NULL,
  `customer_name` VARCHAR(150) NULL DEFAULT NULL,
  `customer_phone` VARCHAR(30) NULL DEFAULT NULL,
  `payment_method` ENUM('cash','credit') NOT NULL DEFAULT 'cash',
  `cash_type` ENUM('cash_in_hand','online') NULL DEFAULT NULL,
  `online_method` VARCHAR(50) NULL DEFAULT NULL,
  `credit_deadline` DATE NULL DEFAULT NULL,
  `total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_profit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `note` VARCHAR(255) NULL DEFAULT NULL,
  `sold_by` INT UNSIGNED NOT NULL,
  `sale_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_txn_customer` (`customer_id`),
  KEY `fk_txn_user` (`sold_by`),
  KEY `idx_txn_date` (`sale_date`),
  CONSTRAINT `fk_txn_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_txn_user` FOREIGN KEY (`sold_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: sale_items
-- One row per product within a sale_transactions row.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL,
  `unit_price` DECIMAL(14,2) NOT NULL,
  `buying_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `subtotal` DECIMAL(14,2) NOT NULL,
  `profit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `fk_item_txn` (`transaction_id`),
  KEY `fk_item_product` (`product_id`),
  CONSTRAINT `fk_item_txn` FOREIGN KEY (`transaction_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: debt_payments
-- Repayments made against a sale_transactions row recorded on credit.
-- Remaining balance = sale_transactions.total_amount - SUM(debt_payments.amount).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `method` ENUM('cash_in_hand','online') NOT NULL DEFAULT 'cash_in_hand',
  `online_method` VARCHAR(50) NULL DEFAULT NULL,
  `payment_date` DATE NOT NULL,
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_debt_sale` (`sale_id`),
  KEY `fk_debt_user` (`recorded_by`),
  CONSTRAINT `fk_debt_sale` FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_debt_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: expenses
-- Electricity, food, rent, transport, etc.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(150) NOT NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT 'General',
  `amount` DECIMAL(14,2) NOT NULL,
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `expense_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_exp_user` (`recorded_by`),
  KEY `idx_exp_date` (`expense_date`),
  CONSTRAINT `fk_exp_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: damages
-- Wasted / spoiled / mistakenly used stock (e.g. rim of paper), OR
-- a non-stock item (equipment, material, furniture, etc.) that got
-- damaged. item_type = 'product' uses product_id + quantity and the
-- loss is calculated from the product's buying price. item_type =
-- 'other' uses item_name + manual_cost, entered by hand, since there
-- is no stock record to calculate a loss value from.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `damages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NULL,
  `item_type` ENUM('product','other') NOT NULL DEFAULT 'product',
  `item_name` VARCHAR(150) NULL DEFAULT NULL,
  `quantity` DECIMAL(12,2) NULL,
  `reason` VARCHAR(255) NOT NULL,
  `loss_value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `manual_cost` DECIMAL(14,2) NULL DEFAULT NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `damage_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_dmg_product` (`product_id`),
  KEY `fk_dmg_user` (`recorded_by`),
  KEY `idx_dmg_date` (`damage_date`),
  CONSTRAINT `fk_dmg_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dmg_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: purchases
-- Stock received - either added one at a time, or imported in bulk
-- from a supplier's Excel/CSV list. Increases product stock_quantity.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `purchases` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL,
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `source` ENUM('manual','import') NOT NULL DEFAULT 'manual',
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `purchase_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_pur_product` (`product_id`),
  KEY `fk_pur_user` (`recorded_by`),
  KEY `idx_pur_date` (`purchase_date`),
  CONSTRAINT `fk_pur_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pur_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: settings
-- Key/value store, e.g. shop name, install lock flag
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key` VARCHAR(60) NOT NULL,
  `setting_value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: audit_log
-- Who created, edited, or deleted what, and when. user_id/user_name/
-- user_role are stored as plain values (no FK to users) so the trail
-- survives even if that user's account is later deleted.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `user_name` VARCHAR(150) NOT NULL,
  `user_role` VARCHAR(20) NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `entity_type` VARCHAR(30) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `description` VARCHAR(500) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_entity` (`entity_type`, `entity_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
