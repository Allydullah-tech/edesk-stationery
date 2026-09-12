
SELECT dp.*
FROM debt_payments dp
LEFT JOIN sale_transactions st ON st.id = dp.sale_id
WHERE st.id IS NULL;
