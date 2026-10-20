<?php
/**
 * Low stock items, shaped to match the Purchases "Import Template"
 * (Product Name, Category, Description, Unit, Quantity, Buying Price,
 * Selling Price). Used by the Dashboard's Low Stock Alerts card and by
 * the Products page's Excel download.
 *
 * - ONLY real products (is_service = 0); services have no stock.
 * - A plain product is checked against its own stock/reorder level.
 * - A product that HAS types is skipped at parent level, and each of its
 *   types is checked individually (product_name = parent, variant_name = type).
 *
 * $limit = null returns every low stock item.
 * Falls back gracefully if the product_variants table doesn't exist yet.
 */
function fetch_low_stock_items(PDO $pdo, ?int $limit = null): array
{
    $limitSql = $limit !== null ? ' LIMIT ' . (int)$limit : '';
    try {
        $stmt = $pdo->query("
            (SELECT p.id, p.name AS name, p.name AS product_name, '' AS variant_name,
                    c.name AS category_name, p.stock_quantity, p.reorder_level, p.unit,
                    p.buying_price, p.selling_price
             FROM products p
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.is_service = 0 AND p.status = 'active' AND p.stock_quantity <= p.reorder_level
               AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id))
            UNION ALL
            (SELECT p.id, CONCAT(p.name, ' → ', pv.variant_name) AS name, p.name AS product_name,
                    pv.variant_name AS variant_name,
                    c.name AS category_name, pv.stock_quantity, pv.reorder_level, pv.unit,
                    pv.buying_price, pv.selling_price
             FROM product_variants pv
             JOIN products p ON p.id = pv.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE p.is_service = 0 AND pv.status = 'active' AND p.status = 'active' AND pv.stock_quantity <= pv.reorder_level)
            ORDER BY stock_quantity ASC, name ASC$limitSql
        ");
        return $stmt->fetchAll();
    } catch (Exception $e) {
        $stmt = $pdo->query("SELECT p.id, p.name AS name, p.name AS product_name, '' AS variant_name,
                    c.name AS category_name, p.stock_quantity, p.reorder_level, p.unit,
                    p.buying_price, p.selling_price
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.is_service = 0 AND p.status = 'active' AND p.stock_quantity <= p.reorder_level
            ORDER BY p.stock_quantity ASC, p.name ASC$limitSql");
        return $stmt->fetchAll();
    }
}
