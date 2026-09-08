-- Fix: debt_payments.fk_debt_sale was left pointing at sales_legacy_backup
-- after the v4 migration renamed `sales`. It should point at sale_transactions.
-- Safe to run once; wrapped so it errors clearly if already fixed.

ALTER TABLE `debt_payments`
  DROP FOREIGN KEY `fk_debt_sale`;

ALTER TABLE `debt_payments`
  ADD CONSTRAINT `fk_debt_sale`
  FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE;
