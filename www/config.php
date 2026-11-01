<?php
/**
 * 基础配置：数据目录 + 统一 JSON 响应。
 *
 * 数据默认落在本目录下的 data/ 里（本地磁盘），容器部署时把该目录挂载出来即可持久化。
 * 想改到别的位置，设置环境变量 GIFTBOOK_DATA_DIR（结尾带斜杠），例如 /var/lib/giftbook/。
 */

$dataDir = getenv('GIFTBOOK_DATA_DIR');
if (!is_string($dataDir) || $dataDir === '') {
    $dataDir = __DIR__ . '/data/';
}
if (substr($dataDir, -1) !== '/') {
    $dataDir .= '/';
}
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0775, true);
}

define('STORAGE_DIR', $dataDir);

/**
 * 配置目录：访问保护相关的配置与运行状态（auth-config.php / auth-state.json / auth-throttle.json）。
 * 默认与数据同目录；容器部署时单独挂一个 config/ 出来，升级重建都不会丢。
 * 可用环境变量 GIFTBOOK_CONFIG_DIR 指定，例如 /var/www/html/config/。
 */
$configDir = getenv('GIFTBOOK_CONFIG_DIR');
if (!is_string($configDir) || $configDir === '') {
    $configDir = $dataDir;
}
if (substr($configDir, -1) !== '/') {
    $configDir .= '/';
}
if (!is_dir($configDir)) {
    @mkdir($configDir, 0775, true);
}

define('CONFIG_DIR', $configDir);

/**
 * 老部署的配置可能还在 data/ 下：首次请求时复制到 config/，只做一次。
 * 复制而不是移动，原文件保留，出问题还能退回去。
 */
if (CONFIG_DIR !== STORAGE_DIR) {
    foreach (['auth-config.php', 'auth-state.json', 'auth-throttle.json'] as $configFile) {
        $target = CONFIG_DIR . $configFile;
        $legacy = STORAGE_DIR . $configFile;
        if (!is_file($target) && is_file($legacy)) {
            @copy($legacy, $target);
            @chmod($target, 0644);
        }
    }
}

date_default_timezone_set(getenv('TZ') ?: 'Asia/Shanghai');

/**
 * 写接口的同源校验：带 Origin 头的跨站请求直接拒绝。
 * 同源请求、curl、老浏览器（不带 Origin）照常放行，不影响正常使用。
 */
function requireSameOrigin() {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        return;
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    // 沙箱 iframe / 跨站跳转会发送 Origin: null；写接口不能把它当作同源。
    if ($origin === 'null') {
        jsonResponse(['success' => false, 'message' => '跨站请求已被拒绝'], 403);
    }
    $originHost = parse_url($origin, PHP_URL_HOST);
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $hostOnly = preg_replace('/:\d+$/', '', $host);
    if (!is_string($originHost) || $originHost === '' || strcasecmp($originHost, $hostOnly) !== 0) {
        jsonResponse(['success' => false, 'message' => '跨站请求已被拒绝'], 403);
    }
}

/**
 * 输出 JSON 并结束请求。
 *
 * @param array $payload 响应体
 * @param int   $status  HTTP 状态码
 */
function jsonResponse($payload, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
