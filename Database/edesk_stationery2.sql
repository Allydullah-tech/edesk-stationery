
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
CREATE TABLE IF NOT EXISTS `sales` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(14,2) NOT NULL,
  `profit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `customer_name` VARCHAR(120) NULL,
  `note` VARCHAR(255) NULL,
  `payment_method` ENUM('cash','credit') NOT NULL DEFAULT 'cash',
  `cash_type` ENUM('cash_in_hand','online') NULL DEFAULT NULL,
  `online_method` VARCHAR(50) NULL DEFAULT NULL,
  `credit_deadline` DATE NULL DEFAULT NULL,
  `customer_phone` VARCHAR(30) NULL DEFAULT NULL,
  `sold_by` INT UNSIGNED NOT NULL,
  `sale_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_sale_product` (`product_id`),
  KEY `fk_sale_user` (`sold_by`),
  KEY `idx_sale_date` (`sale_date`),
  CONSTRAINT `fk_sale_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sale_user` FOREIGN KEY (`sold_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: debt_payments
-- Repayments made against a sale recorded on credit (madeni).
-- The remaining balance on a credit sale is always computed as:
-- sales.total_amount - SUM(debt_payments.amount for that sale).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `payment_date` DATE NOT NULL,
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_debt_sale` (`sale_id`),
  KEY `fk_debt_user` (`recorded_by`),
  CONSTRAINT `fk_debt_sale` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE,
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

SET FOREIGN_KEY_CHECKS = 1;
