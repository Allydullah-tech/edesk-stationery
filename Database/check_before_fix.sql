-- Run this first, just to see if any existing debt_payments rows
-- reference a sale_id that does NOT exist in sale_transactions.
-- If this returns 0 rows, you're safe to run the fix above directly.
SELECT dp.*
FROM debt_payments dp
LEFT JOIN sale_transactions st ON st.id = dp.sale_id
WHERE st.id IS NULL;
