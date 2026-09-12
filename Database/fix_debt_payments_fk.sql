
ALTER TABLE `debt_payments`
  DROP FOREIGN KEY `fk_debt_sale`;

ALTER TABLE `debt_payments`
  ADD CONSTRAINT `fk_debt_sale`
  FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE;
