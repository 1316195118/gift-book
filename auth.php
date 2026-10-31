<?php
require_once 'config.php';

/**
 * 可选访问保护：
 * - 默认关闭（本地自用直接进入）
 * - 开启后使用 PBKDF2-SHA256 校验访问密码，签发 HMAC 签名的 HttpOnly Cookie
 * - 配置与状态保存在 config/ 目录（auth-config.php / auth-state.json），
 *   旧部署里若还在 data/ 下，会自动迁移过去
 */

/** 把旧位置（数据目录）里的配置文件搬到配置目录，只搬一次。 */
function authMigrateLegacy($name) {
    $target = CONFIG_DIR . $name;
    $legacy = STORAGE_DIR . $name;
    if (CONFIG_DIR !== STORAGE_DIR && !is_file($target) && is_file($legacy)) {
        @copy($legacy, $target);
    }
    return $target;
}

function authConfig() {
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $candidates = [
        authMigrateLegacy('auth-config.php'),
        CONFIG_DIR . 'auth-config.php',
        STORAGE_DIR . 'auth-config.php',
        dirname(__DIR__) . '/auth-config.php',
    ];
    $path = null;
    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            $path = $candidate;
            break;
        }
    }
    if ($path === null) {
        return null;
    }
    $loaded = include $path;
    $config = is_array($loaded) ? $loaded : null;
    return $config;
}

function authStatePath() {
    return authMigrateLegacy('auth-state.json');
}

function authState() {
    $path = authStatePath();
    if (is_file($path)) {
        $raw = @file_get_contents($path);
        $decoded = $raw === false ? null : json_decode($raw, true);
        if (is_array($decoded) && array_key_exists('enabled', $decoded)) {
            return $decoded;
        }
    }
    $config = authConfig();
    return [
        'enabled' => is_array($config) && !empty($config['enabled']),
        'iterations' => is_array($config) && isset($config['iterations']) ? (int) $config['iterations'] : 210000,
        'salt' => is_array($config) && isset($config['salt']) ? (string) $config['salt'] : '',
        'hash' => is_array($config) && isset($config['password_hash']) ? (string) $config['password_hash'] : '',
        'secret' => is_array($config) && isset($config['cookie_secret']) ? (string) $config['cookie_secret'] : '',
    ];
}

function authSaveState($state) {
    $path = authStatePath();
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($json === false) {
        return false;
    }
    $temporary = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    if (@file_put_contents($temporary, $json) !== strlen($json)) {
        @unlink($temporary);
        return false;
    }
    if (!@rename($temporary, $path)) {
        @unlink($temporary);
        return false;
    }
    return true;
}

/**
 * 登录防爆破：同一 IP 连续失败达到阈值后临时锁定，锁定时间指数增长。
 * 记录写在配置目录的 auth-throttle.json（与访问保护状态同目录），不参与 Git。
 */
function authThrottlePath() {
    return authMigrateLegacy('auth-throttle.json');
}

function authClientIp() {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    return is_string($ip) && $ip !== '' ? $ip : 'unknown';
}

function authThrottleRead() {
    $path = authThrottlePath();
    if (!is_file($path)) {
        return [];
    }
    $raw = @file_get_contents($path);
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : [];
}

function authThrottleWrite($data) {
    $path = authThrottlePath();
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (@file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE)) === false) {
        return false;
    }
    return @rename($tmp, $path);
}

function authThrottleStatus($ip) {
    $data = authThrottleRead();
    $row = $data[$ip] ?? null;
    if (!is_array($row)) {
        return ['locked' => false, 'retryAfter' => 0, 'fails' => 0];
    }
    $until = (int) ($row['until'] ?? 0);
    if ($until > time()) {
        return ['locked' => true, 'retryAfter' => $until - time(), 'fails' => (int) ($row['fails'] ?? 0)];
    }
    return ['locked' => false, 'retryAfter' => 0, 'fails' => (int) ($row['fails'] ?? 0)];
}

function authThrottleFail($ip) {
    $data = authThrottleRead();
    $row = is_array($data[$ip] ?? null) ? $data[$ip] : ['fails' => 0, 'until' => 0, 'strikes' => 0];
    $now = time();
    // 15 分钟内没再失败，重新计数
    if (($now - (int) ($row['last'] ?? 0)) > 900) {
        $row['fails'] = 0;
        $row['strikes'] = 0;
    }
    $row['fails'] = (int) $row['fails'] + 1;
    $row['last'] = $now;
    if ($row['fails'] >= 5) {
        $row['strikes'] = min(6, (int) ($row['strikes'] ?? 0) + 1);
        $lockSeconds = min(1800, 60 * (2 ** ($row['strikes'] - 1))); // 1,2,4,8,16,30 分钟
        $row['until'] = $now + $lockSeconds;
        $row['fails'] = 0;
    }
    $data[$ip] = $row;
    // 清理过期记录，避免文件无限增长
    foreach ($data as $key => $item) {
        if (!is_array($item) || ($now - (int) ($item['last'] ?? 0)) > 86400) {
            unset($data[$key]);
        }
    }
    authThrottleWrite($data);
    return $row;
}

function authThrottleClear($ip) {
    $data = authThrottleRead();
    if (isset($data[$ip])) {
        unset($data[$ip]);
        authThrottleWrite($data);
    }
}

function authEnabled() {
    $state = authState();
    return !empty($state['enabled']);
}

function authVerifyPassword($password) {
    if (!is_string($password) || $password === '') {
        return false;
    }
    $state = authState();
    if (empty($state['salt']) || empty($state['hash'])) {
        return false;
    }
    $salt = base64_decode((string) $state['salt'], true);
    $expected = base64_decode((string) $state['hash'], true);
    if ($salt === false || $expected === false) {
        return false;
    }
    $derived = hash_pbkdf2('sha256', $password, $salt, (int) $state['iterations'], 32, true);
    return is_string($derived) && hash_equals($expected, $derived);
}

function authCookieValue($expiry, $secret) {
    $payload = (string) $expiry;
    return $payload . '.' . hash_hmac('sha256', $payload, $secret);
}

function authCheck() {
    if (!authEnabled()) {
        return true;
    }
    $state = authState();
    $secret = (string) ($state['secret'] ?? '');
    if ($secret === '') {
        return false;
    }
    $raw = $_COOKIE['ledger_auth'] ?? '';
    if (!is_string($raw) || strpos($raw, '.') === false) {
        return false;
    }
    $parts = explode('.', $raw, 2);
    $expiry = $parts[0];
    $signature = $parts[1];
    if (!ctype_digit($expiry) || (int) $expiry < time()) {
        return false;
    }
    return hash_equals(hash_hmac('sha256', $expiry, $secret), $signature);
}

function authCookieOptions($expires) {
    return [
        'expires' => $expires,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Strict',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    ];
}

function authSetCookie($seconds = 604800) {
    $state = authState();
    $secret = (string) ($state['secret'] ?? '');
    if ($secret === '') {
        return false;
    }
    $expiry = time() + $seconds;
    return setcookie('ledger_auth', authCookieValue($expiry, $secret), authCookieOptions($expiry));
}

function authClearCookie() {
    setcookie('ledger_auth', '', authCookieOptions(time() - 3600));
}

function requireAuth() {
    if (!authCheck()) {
        jsonResponse(['success' => false, 'message' => '未登录或登录已过期'], 401);
    }
}

if (basename($_SERVER['SCRIPT_NAME'] ?? '') === 'auth.php') {
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method === 'GET') {
        jsonResponse(['success' => true, 'authenticated' => authCheck(), 'enabled' => authEnabled()]);
    }
    if ($method === 'POST') {
        if (!authEnabled()) {
            jsonResponse(['success' => true, 'authenticated' => true, 'enabled' => false]);
        }
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        $password = is_array($body) && isset($body['password']) && is_string($body['password']) ? $body['password'] : '';

        $ip = authClientIp();
        $throttle = authThrottleStatus($ip);
        if ($throttle['locked']) {
            $wait = (int) ceil($throttle['retryAfter'] / 60);
            header('Retry-After: ' . $throttle['retryAfter']);
            jsonResponse(['success' => false, 'message' => "尝试过于频繁，请 {$wait} 分钟后再试"], 429);
        }
        if (!authVerifyPassword($password)) {
            authThrottleFail($ip);
            $status = authThrottleStatus($ip);
            usleep(400000);
            if ($status['locked']) {
                $wait = (int) ceil($status['retryAfter'] / 60);
                header('Retry-After: ' . $status['retryAfter']);
                jsonResponse(['success' => false, 'message' => "尝试次数过多，请 {$wait} 分钟后再试"], 429);
            }
            $left = max(1, 5 - (int) $status['fails']);
            jsonResponse(['success' => false, 'message' => "访问密码不正确，还可尝试 {$left} 次"], 401);
        }
        authThrottleClear($ip);
        authSetCookie();
        jsonResponse(['success' => true, 'authenticated' => true, 'enabled' => true]);
    }
    if ($method === 'PUT') {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (!is_array($body) || !array_key_exists('enabled', $body) || !is_bool($body['enabled'])) {
            jsonResponse(['success' => false, 'message' => '无效的请求数据'], 400);
        }
        $state = authState();
        $wasEnabled = !empty($state['enabled']);
        if ($wasEnabled && !authCheck()) {
            $current = isset($body['currentPassword']) && is_string($body['currentPassword']) ? $body['currentPassword'] : '';
            if (!authVerifyPassword($current)) {
                usleep(300000);
                jsonResponse(['success' => false, 'message' => '请输入当前访问密码'], 401);
            }
        }
        if ($body['enabled']) {
            $password = isset($body['password']) && is_string($body['password']) ? $body['password'] : '';
            if (!$wasEnabled && $password === '') {
                jsonResponse(['success' => false, 'message' => '开启访问保护需要设置密码'], 400);
            }
            if ($password !== '') {
                if (strlen($password) < 8) {
                    jsonResponse(['success' => false, 'message' => '访问密码至少 8 位'], 400);
                }
                $salt = random_bytes(16);
                $iterations = 210000;
                $hash = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
                $state['salt'] = base64_encode($salt);
                $state['hash'] = base64_encode($hash);
                $state['iterations'] = $iterations;
            }
            $state['enabled'] = true;
            $state['secret'] = bin2hex(random_bytes(32));
            if (!authSaveState($state)) {
                jsonResponse(['success' => false, 'message' => '保存失败'], 500);
            }
            authSetCookie();
            jsonResponse(['success' => true, 'enabled' => true]);
        }
        $state['enabled'] = false;
        $state['secret'] = bin2hex(random_bytes(32));
        if (!authSaveState($state)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        authClearCookie();
        jsonResponse(['success' => true, 'enabled' => false]);
    }
    if ($method === 'DELETE') {
        authClearCookie();
        jsonResponse(['success' => true]);
    }
    jsonResponse(['success' => false, 'message' => '不支持的请求方法'], 405);
}
