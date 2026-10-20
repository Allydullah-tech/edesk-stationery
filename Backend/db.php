<?php
// Timezone: shared hosts such as InfinityFree run on UTC (or a US zone), which makes every saved time and
// "today" wrong for East Africa. Force Tanzania/Kenya time (UTC+03:00, no daylight saving) for PHP...
date_default_timezone_set('Africa/Dar_es_Salaam');

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
        // ...and for MySQL, so NOW() / CURDATE() in the queries use the same clock. A fixed offset is used on
        // purpose: named zones are often not loaded on shared hosting. (Wrapped so a host that refuses it never breaks the app.)
        try { $pdo->exec("SET time_zone = '+03:00'"); } catch (Throwable $e) { /* keep going with the server default */ }
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
