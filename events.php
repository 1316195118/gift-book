<?php
require_once 'config.php';
require_once 'auth.php';
requireAuth();

function eventsApiId($body) {
    foreach ([$_GET, $_POST, $body] as $source) {
        if (array_key_exists('id', $source)) {
            $value = $source['id'];
            if ((!is_string($value) && !is_int($value)) ||
                !preg_match('/\A[A-Za-z0-9_-]{1,64}\z/', (string) $value)) {
                jsonResponse(['success' => false, 'message' => '无效的事件ID'], 400);
            }
            return (string) $value;
        }
    }
    return null;
}

function eventsApiLock($method) {
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

function eventsApiRead($filename) {
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

function eventsApiWrite($filename, $records) {
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

function eventsApiBody($required) {
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

function eventsApiName($value) {
    if (!is_string($value) || strlen($value) > 480 || !preg_match('//u', $value) ||
        !preg_match('/(*UCP)\S/u', $value)) {
        return false;
    }
    $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') :
        count(preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY));
    return $length <= 120;
}

function eventsApiAmount($value, $maximum, $twoDecimals) {
    if ((!is_int($value) && !is_float($value) && !is_string($value)) || !is_numeric($value)) {
        jsonResponse(['success' => false, 'message' => '无效的金额'], 400);
    }
    $number = $value + 0;
    // 64位整数上限转为浮点会向上取整，不能把该浮点值误判为未越界。
    if (!is_finite($number) || $number < 0 || $number > $maximum ||
        ($maximum === PHP_INT_MAX && PHP_INT_SIZE >= 8 && is_float($number) && $number >= (float) PHP_INT_MAX)) {
        jsonResponse(['success' => false, 'message' => '金额超出允许范围'], 400);
    }
    if ($twoDecimals) {
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
    }
    return $number;
}

function eventsApiDate($value) {
    if (!is_string($value) || !preg_match('/\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}\z/', $value)) {
        return false;
    }
    $date = DateTime::createFromFormat('!Y-m-d\TH:i', $value);
    $errors = DateTime::getLastErrors();
    return $date !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0)) &&
        $date->format('Y-m-d\TH:i') === $value;
}

function eventsApiImage($value) {
    if ($value === null || $value === '') {
        return true;
    }
    if (!is_string($value) || strlen($value) > 5 * 1024 * 1024 ||
        !preg_match('~\Adata:image/[A-Za-z0-9.+-]+;base64,~', $value, $header)) {
        return false;
    }
    $decoded = base64_decode(substr($value, strlen($header[0])), true);
    return $decoded !== false && $decoded !== '';
}

function eventsApiValidate(&$body, $existing = []) {
    if (array_key_exists('name', $body) && !eventsApiName($body['name'])) {
        jsonResponse(['success' => false, 'message' => '名称不能为空且最多120个Unicode字符'], 400);
    }
    // passwordHash 允许为空：表示这本账簿不设管理密码
    if (array_key_exists('passwordHash', $body) && (!is_string($body['passwordHash']) ||
        strlen($body['passwordHash']) > 8 * 1024 * 1024)) {
        jsonResponse(['success' => false, 'message' => '无效的密码摘要'], 400);
    }
    foreach (['coverImage', 'qrcode'] as $field) {
        if (array_key_exists($field, $body) && !eventsApiImage($body[$field])) {
            jsonResponse(['success' => false, 'message' => '图片必须为不超过5MB的图片data URL或null'], 400);
        }
    }
    if (array_key_exists('coverStyle', $body) && $body['coverStyle'] !== null
        && (!is_string($body['coverStyle']) || !preg_match('/\A[a-z0-9-]{0,32}\z/', $body['coverStyle']))) {
        jsonResponse(['success' => false, 'message' => '无效的封面样式'], 400);
    }
    if (array_key_exists('minSpeechAmount', $body)) {
        $body['minSpeechAmount'] = eventsApiAmount($body['minSpeechAmount'], 999999999999, true);
    }
    if (array_key_exists('totalAmount', $body)) {
        $body['totalAmount'] = eventsApiAmount($body['totalAmount'], PHP_INT_MAX, false);
    }
    $datesChanged = false;
    foreach (['startDateTime', 'endDateTime'] as $field) {
        if (array_key_exists($field, $body)) {
            $datesChanged = true;
            if (!eventsApiDate($body[$field])) {
                jsonResponse(['success' => false, 'message' => '时间必须是有效的Y-m-dTH:i格式'], 400);
            }
        }
    }
    if ($datesChanged) {
        $combined = array_replace($existing, $body);
        foreach (['startDateTime', 'endDateTime'] as $field) {
            // 旧记录中未填写的时间不补写，也不强制要求补齐。
            if (isset($combined[$field]) && $combined[$field] !== '' && !eventsApiDate($combined[$field])) {
                jsonResponse(['success' => false, 'message' => '已有时间无效，请同时提交有效时间'], 400);
            }
        }
        if (isset($combined['startDateTime'], $combined['endDateTime']) &&
            $combined['startDateTime'] !== '' && $combined['endDateTime'] !== '' &&
            strcmp($combined['startDateTime'], $combined['endDateTime']) > 0) {
            jsonResponse(['success' => false, 'message' => '开始时间不能晚于结束时间'], 400);
        }
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if (!in_array($method, ['GET', 'POST', 'PUT', 'DELETE'], true)) {
    jsonResponse(['success' => false, 'message' => '不支持的请求方法'], 405);
}
$jsonBody = eventsApiBody($method === 'POST' || $method === 'PUT');
$eventId = eventsApiId($jsonBody);
if (($method === 'PUT' || $method === 'DELETE') && $eventId === null) {
    jsonResponse(['success' => false, 'message' => '缺少事件ID'], 400);
}

// 所有存储读取、校验和提交均处于同一个锁的生命周期内。
eventsApiLock($method);
$events = eventsApiRead('events.json');
$extraFields = ['theme', 'voiceName', 'coverImage', 'startDateTime', 'endDateTime', 'minSpeechAmount', 'qrcode', 'template', 'category', 'location', 'note', 'totalAmount', 'coverStyle'];

switch ($method) {
    case 'GET':
        if ($eventId !== null) {
            if (isset($events[$eventId])) {
                jsonResponse(['success' => true, 'data' => $events[$eventId]]);
            }
            jsonResponse(['success' => false, 'message' => '事件不存在'], 404);
        }
        // 列表只返回展示所需字段，密码哈希仅在单本读取（解锁校验）时返回。
        $publicEvents = [];
        foreach ($events as $id => $event) {
            unset($event['passwordHash']);
            // 人数=礼金记录条数，只读取文件计数，不解密内容。
            $giftFile = STORAGE_DIR . 'gifts_' . $id . '.json';
            $giftCount = 0;
            if (is_file($giftFile)) {
                $rawGifts = @file_get_contents($giftFile);
                $decodedGifts = $rawGifts === false ? null : json_decode($rawGifts, true);
                if (is_array($decodedGifts)) {
                    $giftCount = count($decodedGifts);
                }
            }
            $event['giftCount'] = $giftCount;
            $publicEvents[$id] = $event;
        }
        jsonResponse(['success' => true, 'data' => $publicEvents]);
        break;

    case 'POST':
        if (!isset($jsonBody['name'], $jsonBody['passwordHash'])) {
            jsonResponse(['success' => false, 'message' => '缺少必要参数'], 400);
        }
        eventsApiValidate($jsonBody);
        try {
            do {
                $newEventId = bin2hex(random_bytes(12));
            } while (array_key_exists($newEventId, $events));
        } catch (Throwable $error) {
            jsonResponse(['success' => false, 'message' => '生成事件ID失败'], 500);
        }
        $maxDisplayId = 0;
        foreach ($events as $existing) {
            if (isset($existing['displayId']) && preg_match('/\A[0-9]{3}\z/', (string) $existing['displayId'])) {
                $maxDisplayId = max($maxDisplayId, (int) $existing['displayId']);
            }
        }
        // 只增不复用：删除旧账簿后，新账簿不会捡回旧编号。
        $nextDisplayId = $maxDisplayId + 1;
        if ($nextDisplayId > 999) {
            jsonResponse(['success' => false, 'message' => '账簿编号已用完（最多 999 本）'], 409);
        }
        $newEvent = [
            'id' => $newEventId,
            'name' => $jsonBody['name'],
            'passwordHash' => $jsonBody['passwordHash'],
            'displayId' => sprintf('%03d', $nextDisplayId),
            'createdAt' => date('Y-m-d H:i:s'),
            'updatedAt' => date('Y-m-d H:i:s')
        ];
        foreach ($extraFields as $field) {
            if (array_key_exists($field, $jsonBody)) {
                $newEvent[$field] = $jsonBody[$field];
            }
        }
        $events[$newEventId] = $newEvent;
        if (!eventsApiWrite('events.json', $events)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => $newEvent]);
        break;

    case 'PUT':
        if (!isset($events[$eventId])) {
            jsonResponse(['success' => false, 'message' => '事件不存在'], 404);
        }
        eventsApiValidate($jsonBody, $events[$eventId]);
        foreach (array_merge(['name', 'passwordHash'], $extraFields) as $field) {
            if (array_key_exists($field, $jsonBody)) {
                $events[$eventId][$field] = $jsonBody[$field];
            }
        }
        $events[$eventId]['updatedAt'] = date('Y-m-d H:i:s');
        if (!eventsApiWrite('events.json', $events)) {
            jsonResponse(['success' => false, 'message' => '保存失败'], 500);
        }
        jsonResponse(['success' => true, 'data' => $events[$eventId]]);
        break;

    case 'DELETE':
        if (!isset($events[$eventId])) {
            jsonResponse(['success' => false, 'message' => '事件不存在'], 404);
        }
        unset($events[$eventId]);
        if (!eventsApiWrite('events.json', $events)) {
            jsonResponse(['success' => false, 'message' => '删除失败'], 500);
        }
        // 顺带清掉这本账簿的礼金文件，别留下空壳
        $giftFile = STORAGE_DIR . 'gifts_' . preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$eventId) . '.json';
        if (is_file($giftFile)) {
            @unlink($giftFile);
        }
        jsonResponse(['success' => true]);
        break;
}
