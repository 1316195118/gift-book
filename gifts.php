<?php
require_once 'config.php';
require_once 'auth.php';
requireAuth();

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

function giftsApiName($value) {
    if (!is_string($value) || strlen($value) > 480 || !preg_match('//u', $value) ||
        !preg_match('/(*UCP)\S/u', $value)) {
        return false;
    }
    $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') :
        count(preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY));
    return $length <= 120;
}

function giftsApiAmount($value) {
    if ((!is_int($value) && !is_float($value) && !is_string($value)) || !is_numeric($value)) {
        jsonResponse(['success' => false, 'message' => '无效的金额'], 400);
    }
    $number = $value + 0;
    if (!is_finite($number) || $number < 0 || $number > 999999999999) {
        jsonResponse(['success' => false, 'message' => '金额超出允许范围'], 400);
    }
    $text = is_string($value) ? trim($value) : json_encode($value, JSON_PRESERVE_ZERO_FRACTION);
    $parts = preg_split('/[eE]/', $text);
    $mantissa = $parts[0];
    $exponent = isset($parts[1]) ? (int) $parts[1] : 0;
    $point = strpos($mantissa, '.');
    $fractionLength = $point === false ? 0 : strlen($mantissa) - $point - 1;
    $digits = str_replace(['+', '-', '.'], '', $mantissa);
    $significant = rtrim($digits, '0');
    // 按十进制位数检查，避免浮点误差容忍值放过第三位小数。
    if ($significant !== '' && $fractionLength - (strlen($digits) - strlen($significant)) - $exponent > 2) {
        jsonResponse(['success' => false, 'message' => '金额最多保留两位小数'], 400);
    }
    return $number;
}

function giftsApiDate($value) {
    if (!is_string($value) || !preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}\z/', $value)) {
        return false;
    }
    $date = DateTime::createFromFormat('!Y-m-d\TH:i', $value);
    $errors = DateTime::getLastErrors();
    return $date !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0)) &&
        $date->format('Y-m-d\TH:i') === $value;
}

function giftsApiTimestamp($value) {
    if (!is_string($value) ||
        !preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})?\z/', $value)) {
        return false;
    }
    try {
        new DateTimeImmutable($value);
        return true;
    } catch (Throwable $error) {
        return false;
    }
}

function giftsApiImage($value) {
    if ($value === '') {
        return true;
    }
    if (!is_string($value) || strlen($value) > 5 * 1024 * 1024 ||
        !preg_match('~\Adata:image/[A-Za-z0-9.+-]+;base64,~', $value, $header)) {
        return false;
    }
    $decoded = base64_decode(substr($value, strlen($header[0])), true);
    return $decoded !== false && $decoded !== '';
}

function giftsApiValidate(&$body) {
    foreach (['name', 'giverName'] as $field) {
        if (array_key_exists($field, $body) && !giftsApiName($body[$field])) {
            jsonResponse(['success' => false, 'message' => '姓名不能为空且最多120个Unicode字符'], 400);
        }
    }
    if (array_key_exists('amount', $body)) {
        $body['amount'] = giftsApiAmount($body['amount']);
    }
    if (array_key_exists('timestamp', $body) && !giftsApiTimestamp($body['timestamp'])) {
        jsonResponse(['success' => false, 'message' => '时间必须是有效的ISO 8601格式'], 400);
    }
    if (array_key_exists('image', $body) && !giftsApiImage($body['image'])) {
        jsonResponse(['success' => false, 'message' => '图片必须为不超过5MB的图片data URL'], 400);
    }
    if (array_key_exists('encryptedContent', $body)) {
        $payload = $body['encryptedContent'];
        if (!is_string($payload) && !is_object($payload) && !is_array($payload)) {
            jsonResponse(['success' => false, 'message' => '无效的加密内容'], 400);
        }
        $encoded = is_string($payload) ? $payload : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded === false || strlen($encoded) > 8 * 1024 * 1024) {
            jsonResponse(['success' => false, 'message' => '加密内容不能超过8MB'], 400);
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
$fields = ['name', 'amount', 'giverName', 'encryptedContent', 'timestamp', 'image'];

switch ($method) {
    case 'GET':
        if ($giftId !== null) {
            if (isset($gifts[$giftId])) {
                jsonResponse(['success' => true, 'data' => $gifts[$giftId]]);
            }
            jsonResponse(['success' => false, 'message' => '礼物不存在'], 404);
        }
        jsonResponse(['success' => true, 'data' => $gifts]);
        break;

    case 'POST':
        if (!isset($jsonBody['name'], $jsonBody['amount'], $jsonBody['giverName'], $jsonBody['encryptedContent'])) {
            jsonResponse(['success' => false, 'message' => '缺少必要参数'], 400);
        }
        giftsApiValidate($jsonBody);
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
            'name' => $jsonBody['name'],
            'amount' => $jsonBody['amount'],
            'giverName' => $jsonBody['giverName'],
            'encryptedContent' => $jsonBody['encryptedContent'],
            'createdAt' => date('Y-m-d H:i:s'),
            'updatedAt' => date('Y-m-d H:i:s')
        ];
        foreach (['timestamp', 'image'] as $field) {
            if (array_key_exists($field, $jsonBody)) {
                $newGift[$field] = $jsonBody[$field];
            }
        }
        $gifts[$newGiftId] = $newGift;
        if (!giftsApiWrite($giftFile, $gifts)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => $newGift]);
        break;

    case 'PUT':
        if (!isset($gifts[$giftId])) {
            jsonResponse(['success' => false, 'message' => '礼物不存在'], 404);
        }
        giftsApiValidate($jsonBody);
        foreach ($fields as $field) {
            if (array_key_exists($field, $jsonBody)) {
                $gifts[$giftId][$field] = $jsonBody[$field];
            }
        }
        $gifts[$giftId]['updatedAt'] = date('Y-m-d H:i:s');
        if (!giftsApiWrite($giftFile, $gifts)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => $gifts[$giftId]]);
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
