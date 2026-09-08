<?php
/**
 * EDESK STATIONERY - Installer
 * Run this once in your browser: http://yourdomain/Backend/install.php
 * It will:
 *   1. Connect to MySQL using the details you provide
 *   2. Import Database/edesk_stationery.sql (create all tables)
 *   3. Create Backend/config.php with your DB details
 *   4. Create the first ADMIN account for the system
 *
 * After install completes, this file blocks itself from running again.
 * Delete config.php manually if you ever need to reinstall.
 */

error_reporting(E_ALL);
ini_set('display_errors', 1);

$configPath = __DIR__ . '/config.php';
$alreadyInstalled = file_exists($configPath);

$errors = [];
$success = false;

if ($alreadyInstalled) {
    $existing = require $configPath;
    if (!empty($existing['installed'])) {
        // Block re-install
        ?>
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Already Installed</title>
        <style>body{font-family:Arial,sans-serif;background:#101B30;color:#fff;display:flex;height:100vh;align-items:center;justify-content:center;text-align:center}
        .box{background:#16213C;padding:40px;border-radius:14px;max-width:420px}
        a{color:#F0B849}</style></head><body>
        <div class="box">
        <h2 style="color:#F0B849">EDESK STATIONERY</h2>
        <p>The system is already installed.</p>
        <p><a href="../Frontend/index.html">Go to the website &rarr;</a></p>
        <p style="font-size:13px;color:#9aa5b8">To reinstall, delete <code>Backend/config.php</code> first.</p>
        </div></body></html>
        <?php
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $db_host = trim($_POST['db_host'] ?? 'localhost');
    $db_name = trim($_POST['db_name'] ?? 'edesk_stationery');
    $db_user = trim($_POST['db_user'] ?? 'root');
    $db_pass = $_POST['db_pass'] ?? '';
    $shop_name = trim($_POST['shop_name'] ?? 'EDESK STATIONERY');

    $admin_name = trim($_POST['admin_name'] ?? '');
    $admin_username = trim($_POST['admin_username'] ?? '');
    $admin_password = $_POST['admin_password'] ?? '';
    $admin_password2 = $_POST['admin_password2'] ?? '';
    $security_question = trim($_POST['security_question'] ?? '');
    $security_answer = trim($_POST['security_answer'] ?? '');

    if ($db_host === '' || $db_name === '' || $db_user === '') $errors[] = 'Database host, name and user are required.';
    if ($admin_name === '' || $admin_username === '') $errors[] = 'Admin full name and username are required.';
    if (strlen($admin_password) < 6) $errors[] = 'Admin password must be at least 6 characters.';
    if ($admin_password !== $admin_password2) $errors[] = 'Admin passwords do not match.';
    if ($security_question === '' || $security_answer === '') $errors[] = 'Security question and answer are required.';

    if (empty($errors)) {
        try {
            // 1. Connect without DB name first, create DB if missing
            $pdoRoot = new PDO("mysql:host={$db_host};charset=utf8mb4", $db_user, $db_pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
            ]);
            $pdoRoot->exec("CREATE DATABASE IF NOT EXISTS `{$db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");

            // 2. Connect to the actual DB
            $pdo = new PDO("mysql:host={$db_host};dbname={$db_name};charset=utf8mb4", $db_user, $db_pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
            ]);

            // 3. Import schema from Database/edesk_stationery.sql
            $sqlFile = dirname(__DIR__) . '/Database/edesk_stationery.sql';
            if (!file_exists($sqlFile)) {
                throw new Exception('Could not find Database/edesk_stationery.sql. Make sure the three folders (Frontend, Backend, Database) are kept together.');
            }
            $sql = str_replace("\r\n", "\n", file_get_contents($sqlFile));

            // Strip full-line SQL comments first, so a leading "-- ..." line
            // never causes a whole CREATE TABLE block to be skipped.
            $lines = explode("\n", $sql);
            $lines = array_filter($lines, function ($line) {
                return strpos(ltrim($line), '--') !== 0;
            });
            $sqlNoComments = implode("\n", $lines);

            // Now split on statement-ending semicolons and run each one.
            $statements = array_filter(array_map('trim', explode(';', $sqlNoComments)));
            foreach ($statements as $stmt) {
                $stmt = trim($stmt);
                if ($stmt === '') continue;
                $pdo->exec($stmt);
            }

            // 4. Create the first admin user
            $checkStmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
            $checkStmt->execute([$admin_username]);
            if ($checkStmt->fetchColumn() > 0) {
                throw new Exception('That admin username already exists in the database.');
            }

            $insert = $pdo->prepare('INSERT INTO users (full_name, username, password_hash, role, security_question, security_answer_hash, status, created_at, updated_at)
                VALUES (?, ?, ?, "admin", ?, ?, "active", NOW(), NOW())');
            $insert->execute([
                $admin_name,
                $admin_username,
                password_hash($admin_password, PASSWORD_DEFAULT),
                $security_question,
                password_hash(strtolower(trim($security_answer)), PASSWORD_DEFAULT),
            ]);

            // 5. Save shop name into settings table
            $set = $pdo->prepare('INSERT INTO settings (setting_key, setting_value) VALUES ("shop_name", ?)
                ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)');
            $set->execute([$shop_name]);

            // 6. Write config.php
            $configContent = "<?php\n// Auto-generated by install.php on " . date('Y-m-d H:i:s') . "\nreturn [\n" .
                "    'db_host'    => " . var_export($db_host, true) . ",\n" .
                "    'db_name'    => " . var_export($db_name, true) . ",\n" .
                "    'db_user'    => " . var_export($db_user, true) . ",\n" .
                "    'db_pass'    => " . var_export($db_pass, true) . ",\n" .
                "    'db_charset' => 'utf8mb4',\n" .
                "    'shop_name'  => " . var_export($shop_name, true) . ",\n" .
                "    'installed'  => true,\n" .
                "];\n";
            file_put_contents($configPath, $configContent);

            $success = true;
        } catch (Exception $e) {
            $errors[] = 'Install failed: ' . $e->getMessage();
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Install - EDESK STATIONERY</title>
<style>
  :root{--navy:#101B30;--navy2:#16213C;--gold:#F0B849;--text:#EAEEF6;--muted:#93A0B8;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:var(--navy);color:var(--text);padding:30px 16px;}
  .wrap{max-width:560px;margin:0 auto;}
  .brand{text-align:center;margin-bottom:24px;}
  .brand h1{color:var(--gold);font-size:22px;letter-spacing:1px;margin:6px 0 2px;}
  .brand p{color:var(--muted);font-size:12px;margin:0;}
  .card{background:var(--navy2);border-radius:14px;padding:26px;box-shadow:0 10px 30px rgba(0,0,0,.3);}
  h2{font-size:16px;color:var(--gold);margin:18px 0 10px;border-bottom:1px solid #24304c;padding-bottom:6px;}
  h2:first-child{margin-top:0;}
  label{display:block;font-size:12.5px;color:var(--muted);margin:10px 0 4px;}
  input,select{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #2a3752;background:#0e1626;color:var(--text);font-size:14px;}
  input:focus{outline:1px solid var(--gold);}
  button{width:100%;margin-top:22px;padding:13px;border:none;border-radius:9px;background:var(--gold);color:#101B30;font-weight:700;font-size:14.5px;cursor:pointer;}
  button:hover{opacity:.92;}
  .row{display:flex;gap:12px;}
  .row > div{flex:1;}
  .msg{padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;}
  .err{background:#3a1c22;color:#ff9b9b;border:1px solid #5c2530;}
  .ok{background:#173325;color:#8be0ac;border:1px solid #245c3d;}
  .foot{text-align:center;color:var(--muted);font-size:11.5px;margin-top:18px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <h1>EDESK STATIONERY</h1>
    <p>PRINT &amp; DIGITAL &mdash; System Installer</p>
  </div>

  <div class="card">
    <?php if ($success): ?>
      <div class="msg ok">Installation complete! Your admin account has been created.</div>
      <p style="font-size:14px;">You can now log in as an administrator.</p>
      <a href="../Frontend/index.html"><button type="button">Go to the Website</button></a>
    <?php else: ?>

      <?php if (!empty($errors)): ?>
        <div class="msg err"><?php foreach ($errors as $e) echo htmlspecialchars($e) . '<br>'; ?></div>
      <?php endif; ?>

      <form method="POST" autocomplete="off">
        <h2>Database Connection</h2>
        <label>Database Host</label>
        <input type="text" name="db_host" value="<?= htmlspecialchars($_POST['db_host'] ?? 'localhost') ?>" required>

        <label>Database Name</label>
        <input type="text" name="db_name" value="<?= htmlspecialchars($_POST['db_name'] ?? 'edesk_stationery') ?>" required>

        <div class="row">
          <div>
            <label>Database Username</label>
            <input type="text" name="db_user" value="<?= htmlspecialchars($_POST['db_user'] ?? 'root') ?>" required>
          </div>
          <div>
            <label>Database Password</label>
            <input type="password" name="db_pass" value="">
          </div>
        </div>

        <h2>Business Details</h2>
        <label>Shop / Business Name</label>
        <input type="text" name="shop_name" value="<?= htmlspecialchars($_POST['shop_name'] ?? 'EDESK STATIONERY') ?>" required>

        <h2>First Administrator Account</h2>
        <label>Full Name</label>
        <input type="text" name="admin_name" value="<?= htmlspecialchars($_POST['admin_name'] ?? '') ?>" required>

        <label>Username</label>
        <input type="text" name="admin_username" value="<?= htmlspecialchars($_POST['admin_username'] ?? '') ?>" required>

        <div class="row">
          <div>
            <label>Password (min. 6 characters)</label>
            <input type="password" name="admin_password" required minlength="6">
          </div>
          <div>
            <label>Confirm Password</label>
            <input type="password" name="admin_password2" required minlength="6">
          </div>
        </div>

        <label>Security Question (used to reset password later)</label>
        <input type="text" name="security_question" placeholder="e.g. What is your mother's maiden name?" value="<?= htmlspecialchars($_POST['security_question'] ?? '') ?>" required>

        <label>Answer to Security Question</label>
        <input type="text" name="security_answer" required>

        <button type="submit">Install System</button>
      </form>
    <?php endif; ?>
  </div>
  <p class="foot">Keep the Frontend, Backend and Database folders together in the same location.</p>
</div>
</body>
</html>