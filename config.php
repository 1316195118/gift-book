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

date_default_timezone_set(getenv('TZ') ?: 'Asia/Shanghai');

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
