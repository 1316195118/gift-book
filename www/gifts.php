<?php
require_once 'config.php';
require_once 'auth.php';
requireAuth();
requireSameOrigin();

function giftsApiId($name, $body, $label) {
    foreach ([$_GET, $_POST, $body] as $source) {
        if (array_key_exists($name, $source)) {
            $value = $source[$name];
            if ((!is_string($value) && !is_int($value)) ||
                !preg_match('/\A[A-Za-z0-9_-]{1,64}\z/', (string) $value)) {
                jsonResponse(['success' => false, 'message' => '无效的' . $label], 400);
            }
            return (string) $value;
        }
    }
    return null;
}

function giftsApiLock($method) {
    $handle = @fopen(STORAGE_DIR . '.ledger.lock', 'c');
    if ($handle === false) {
        jsonResponse(['success' => false, 'message' => '账簿暂时不可用'], 503);
    }
    if (!@flock($handle, $method === 'GET' ? LOCK_SH : LOCK_EX)) {
        @fclose($handle);
        jsonResponse(['success' => false, 'message' => '账簿暂时不可用'], 503);
    }
    register_shutdown_function(function () use ($handle) {
        @flock($handle, LOCK_UN);
        @fclose($handle);
    });
}

function giftsApiRead($filename) {
    $path = STORAGE_DIR . $filename;
    if (!file_exists($path) && !is_link($path)) {
        return [];
    }
    $content = @file_get_contents($path);
    if ($content === false) {
        jsonResponse(['success' => false, 'message' => '账簿读取失败'], 500);
    }
    $decoded = json_decode($content);
    if (json_last_error() !== JSON_ERROR_NONE ||
        (!is_object($decoded) && !is_array($decoded)) || json_encode($decoded) === false) {
        jsonResponse(['success' => false, 'message' => '账簿数据损坏，已拒绝操作'], 500);
    }
    $records = [];
    foreach ($decoded as $key => $record) {
        if (!is_object($record)) {
            jsonResponse(['success' => false, 'message' => '账簿数据结构无效，已拒绝操作'], 500);
        }
        // 只转换记录本身，保留未知字段中的对象、空对象和数组。
        $records[$key] = (array) $record;
    }
    return $records;
}

/**
 * Gift details live inside encryptedContent. Never return legacy duplicated
 * plaintext metadata to API callers; old files are cleaned by the CLI migration.
 */
function giftsApiPublicRecord($record) {
    if (!is_array($record)) {
        return $record;
    }
    // 只返回协议内字段，旧版本遗留的姓名、金额、送礼人、图片等字段一律不下发。
    $public = [];
    foreach (['id', 'eventId', 'encryptedContent', 'createdAt', 'updatedAt'] as $field) {
        if (array_key_exists($field, $record)) {
            $public[$field] = $record[$field];
        }
    }
    return $public;
}

function giftsApiCipherLooksUsable($value) {
    if (!is_string($value) || $value === '') {
        return false;
    }
    $raw = base64_decode($value, true);
    return $raw !== false
        && strlen($raw) >= 32
        && substr($raw, 0, 8) === 'Salted__'
        && (strlen($raw) - 16) % 16 === 0;
}

function giftsApiWrite($filename, $records) {
    $encoded = json_encode($records, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if ($encoded === false) {
        return false;
    }
    $temporary = null;
    try {
        $candidate = STORAGE_DIR . '.' . $filename . '.' . bin2hex(random_bytes(12)) . '.tmp';
        $handle = @fopen($candidate, 'x+b');
        if ($handle === false) {
            return false;
        }
        $temporary = $candidate;
        if (!@fclose($handle) || @file_put_contents($temporary, $encoded) !== strlen($encoded)) {
            return false;
        }
        return @rename($temporary, STORAGE_DIR . $filename);
    } catch (Throwable $error) {
        return false;
    } finally {
        if ($temporary !== null && file_exists($temporary)) {
            @unlink($temporary);
        }
    }
}

function giftsApiBody($required) {
    $raw = file_get_contents('php://input');
    if ($raw === '' && !$required) {
        return [];
    }
    $decoded = $raw === false ? null : json_decode($raw);
    if (json_last_error() !== JSON_ERROR_NONE || !is_object($decoded) ||
        ($required && (array) $decoded === [])) {
        jsonResponse(['success' => false, 'message' => '无效的请求数据'], 400);
    }
    return (array) $decoded;
}

function giftsApiValidate($body) {
    if (array_key_exists('encryptedContent', $body)) {
        $payload = $body['encryptedContent'];
        if (!is_string($payload)) {
            jsonResponse(['success' => false, 'message' => '无效的加密内容'], 400);
        }
        if (strlen($payload) > 8 * 1024 * 1024) {
            jsonResponse(['success' => false, 'message' => '加密内容不能超过8MB'], 400);
        }
        if (!giftsApiCipherLooksUsable($payload)) {
            jsonResponse(['success' => false, 'message' => '无效的加密内容'], 400);
        }
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST', 'PUT', 'DELETE'], true)) {
    jsonResponse(['success' => false, 'message' => '不支持的请求方法'], 405);
}
$jsonBody = giftsApiBody($method === 'POST' || $method === 'PUT');
$eventId = giftsApiId('eventId', $jsonBody, '事件ID');
if ($eventId === null) {
    jsonResponse(['success' => false, 'message' => '缺少事件ID'], 400);
}
$giftId = giftsApiId('id', $jsonBody, '礼物ID');
if ($method === 'PUT' && $giftId === null) {
    jsonResponse(['success' => false, 'message' => '缺少礼物ID'], 400);
}
$requestId = null;
if ($method === 'POST' && array_key_exists('requestId', $jsonBody)) {
    $candidate = $jsonBody['requestId'];
    if (!is_string($candidate) || !preg_match('/\A[A-Za-z0-9_-]{8,64}\z/', $candidate)) {
        jsonResponse(['success' => false, 'message' => '无效的请求ID'], 400);
    }
    $requestId = $candidate;
}
$giftFile = 'gifts_' . $eventId . '.json';

// 与 events.php 共用目录锁，父事件检查和礼金提交之间不能被其他写请求插入。
giftsApiLock($method);
if ($method === 'POST') {
    $events = giftsApiRead('events.json');
    if (!isset($events[$eventId])) {
        jsonResponse(['success' => false, 'message' => '事件不存在'], 404);
    }
}
$gifts = giftsApiRead($giftFile);
$fields = ['encryptedContent'];

switch ($method) {
    case 'GET':
        if ($giftId !== null) {
            if (isset($gifts[$giftId])) {
                jsonResponse(['success' => true, 'data' => giftsApiPublicRecord($gifts[$giftId])]);
            }
            jsonResponse(['success' => false, 'message' => '礼物不存在'], 404);
        }
        $publicGifts = [];
        foreach ($gifts as $id => $gift) {
            $publicGifts[$id] = giftsApiPublicRecord($gift);
        }
        jsonResponse(['success' => true, 'data' => $publicGifts]);
        break;

    case 'POST':
        if (!isset($jsonBody['encryptedContent'])) {
            jsonResponse(['success' => false, 'message' => '缺少必要参数'], 400);
        }
        giftsApiValidate($jsonBody);
        // 同一笔礼金在超时/断网后重试时复用 requestId，服务端只落一次。
        if ($requestId !== null) {
            foreach ($gifts as $existing) {
                if (is_array($existing) && ($existing['requestId'] ?? null) === $requestId) {
                    jsonResponse(['success' => true, 'data' => giftsApiPublicRecord($existing), 'duplicate' => true]);
                }
            }
        }
        try {
            do {
                $newGiftId = bin2hex(random_bytes(12));
            } while (array_key_exists($newGiftId, $gifts));
        } catch (Throwable $error) {
            jsonResponse(['success' => false, 'message' => '生成礼物ID失败'], 500);
        }
        $newGift = [
            'id' => $newGiftId,
            'eventId' => $eventId,
            'encryptedContent' => $jsonBody['encryptedContent'],
            'createdAt' => date('Y-m-d H:i:s'),
            'updatedAt' => date('Y-m-d H:i:s')
        ];
        if ($requestId !== null) {
            $newGift['requestId'] = $requestId;
        }
        $gifts[$newGiftId] = $newGift;
        if (!giftsApiWrite($giftFile, $gifts)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => giftsApiPublicRecord($newGift)]);
        break;

    case 'PUT':
        if (!isset($gifts[$giftId])) {
            jsonResponse(['success' => false, 'message' => '礼物不存在'], 404);
        }
        if (!isset($jsonBody['encryptedContent'])) {
            jsonResponse(['success' => false, 'message' => '缺少加密内容'], 400);
        }
        giftsApiValidate($jsonBody);
        foreach ($fields as $field) {
            if (array_key_exists($field, $jsonBody)) {
                $gifts[$giftId][$field] = $jsonBody[$field];
            }
        }
        // Updating an old encrypted record also clears any duplicated plaintext fields.
        foreach (['name', 'amount', 'giverName'] as $field) {
            unset($gifts[$giftId][$field]);
        }
        $gifts[$giftId]['updatedAt'] = date('Y-m-d H:i:s');
        if (!giftsApiWrite($giftFile, $gifts)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => giftsApiPublicRecord($gifts[$giftId])]);
        break;

    case 'DELETE':
        if ($giftId !== null) {
            if (!isset($gifts[$giftId])) {
                jsonResponse(['success' => false, 'message' => '礼物不存在'], 404);
            }
            unset($gifts[$giftId]);
        } else {
            // 保留旧接口不传礼物ID时清空该事件礼金的行为。
            $gifts = [];
        }
        if (!giftsApiWrite($giftFile, $gifts)) {
            jsonResponse(['success' => false, 'message' => '删除失败'], 500);
        }
        jsonResponse(['success' => true]);
        break;
}
