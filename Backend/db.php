<?php
/**
 * EDESK STATIONERY - Database Connection
 * Provides a single shared PDO instance.
 */

if (!file_exists(__DIR__ . '/config.php')) {
    header('Content-Type: application/json');
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'message' => 'The system is not installed yet. Please open install.php in your browser first.'
    ]);
    exit;
}

$config = require __DIR__ . '/config.php';

function get_db(): PDO
{
    static $pdo = null;
    global $config;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = "mysql:host={$config['db_host']};dbname={$config['db_name']};charset={$config['db_charset']}";

    try {
        $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Database connection failed. Please check Backend/config.php',
        ]);
        exit;
    }
}
