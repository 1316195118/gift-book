#!/usr/local/bin/php
<?php
declare(strict_types=1);

// CLI only. The default is a dry run; --apply is required to rewrite old files.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

$configFile = getenv('GIFTBOOK_CONFIG_FILE');
if (!is_string($configFile) || $configFile === '') {
    $configFile = '/var/www/html/config.php';
}
if (!is_file($configFile)) {
    // 直接从源码目录运行时没有 /var/www/html，回退到仓库里的 www/config.php。
    $sourceConfig = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'www' . DIRECTORY_SEPARATOR . 'config.php';
    if (is_file($sourceConfig)) {
        $configFile = $sourceConfig;
    }
}
if (!is_file($configFile)) {
    fwrite(STDERR, "Cannot find config.php; set GIFTBOOK_CONFIG_FILE to the webroot config file.\n");
    exit(1);
}
require_once $configFile;

$args = array_slice($argv, 1);
if ($args !== [] && $args !== ['--apply']) {
    fwrite(STDERR, "Usage: php migrate-private-gifts.php [--apply]\n");
    exit(64);
}
$apply = $args === ['--apply'];
$storageDir = rtrim(STORAGE_DIR, '/\\') . DIRECTORY_SEPARATOR;
$lock = @fopen($storageDir . '.ledger.lock', 'c');
if ($lock === false || !@flock($lock, LOCK_EX)) {
    fwrite(STDERR, "Unable to lock ledger storage; no files changed.\n");
    exit(1);
}

try {
    $files = glob($storageDir . 'gifts_*.json', GLOB_NOSORT) ?: [];
    $plans = [];
    $encryptedRecords = 0;
    $recordsWithoutCiphertext = 0;
    $fieldsToRemove = 0;
    $privateFields = ['name', 'amount', 'giverName'];

    // 只认 OpenSSL/LedgerCrypto 的 "Salted__" 格式，避免把占位字符串当成密文
    // 后删掉唯一可读的明文字段。
    $hasUsableCipher = static function ($value): bool {
        if (!is_string($value) || $value === '') {
            return false;
        }
        $raw = base64_decode($value, true);
        if ($raw === false || strlen($raw) < 32 || substr($raw, 0, 8) !== 'Salted__') {
            return false;
        }
        return (strlen($raw) - 16) % 16 === 0;
    };

    // Validate every candidate before changing any file.
    foreach ($files as $path) {
        if (is_link($path) || !is_file($path)) {
            continue;
        }
        $raw = @file_get_contents($path);
        if ($raw === false) {
            throw new RuntimeException('A gift file could not be read; no files changed.');
        }
        $records = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($records)) {
            throw new RuntimeException('A gift file is not valid JSON; no files changed.');
        }

        $clean = $records;
        $fileFieldsRemoved = 0;
        foreach ($records as $id => $record) {
            if (!is_array($record)) {
                throw new RuntimeException('A gift record has an invalid structure; no files changed.');
            }
            if (!$hasUsableCipher($record['encryptedContent'] ?? null)) {
                // Preserve records that cannot be proven recoverable from encryptedContent.
                $recordsWithoutCiphertext++;
                continue;
            }
            $encryptedRecords++;
            foreach ($privateFields as $field) {
                if (array_key_exists($field, $record)) {
                    unset($clean[$id][$field]);
                    $fileFieldsRemoved++;
                }
            }
        }

        if ($fileFieldsRemoved > 0) {
            $encoded = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
            $mode = @fileperms($path);
            if ($encoded === false || $mode === false) {
                throw new RuntimeException('A gift file could not be prepared; no files changed.');
            }
            $plans[] = [
                'path' => $path,
                'contents' => $encoded,
                'mode' => $mode & 0777,
                'uid' => @fileowner($path),
                'gid' => @filegroup($path),
            ];
            $fieldsToRemove += $fileFieldsRemoved;
        }
    }

    echo 'Files scanned: ' . count($files) . PHP_EOL;
    echo 'Encrypted records checked: ' . $encryptedRecords . PHP_EOL;
    echo 'Records preserved without a usable encryptedContent: ' . $recordsWithoutCiphertext . PHP_EOL;
    echo 'Duplicate plaintext fields to remove: ' . $fieldsToRemove . PHP_EOL;

    if (!$apply || $plans === []) {
        echo $apply ? "Nothing to migrate.\n" : "Dry run only; no files changed. Add --apply after reviewing these counts.\n";
        exit(0);
    }

    $backupDir = $storageDir . '.privacy-migration-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3));
    if (!@mkdir($backupDir, 0700) || !@chmod($backupDir, 0700)) {
        throw new RuntimeException('Could not create a private backup directory; no files changed.');
    }

    // Back up all files to be changed before the first write.
    foreach ($plans as $plan) {
        $backupFile = $backupDir . DIRECTORY_SEPARATOR . basename($plan['path']);
        if (!@copy($plan['path'], $backupFile)) {
            throw new RuntimeException('A backup file could not be created; no files changed.');
        }
        @chmod($backupFile, 0600);
    }

    $migratedFiles = 0;
    foreach ($plans as $plan) {
        $temporary = @tempnam($storageDir, '.giftbook-privacy-');
        if ($temporary === false) {
            throw new RuntimeException('Could not create a temporary file. Backup: ' . $backupDir);
        }
        $written = @file_put_contents($temporary, $plan['contents'], LOCK_EX);
        if ($written !== strlen($plan['contents'])) {
            @unlink($temporary);
            throw new RuntimeException('Could not write a cleaned gift file. Backup: ' . $backupDir);
        }
        @chmod($temporary, $plan['mode']);
        if (is_int($plan['uid'])) {
            @chown($temporary, $plan['uid']);
        }
        if (is_int($plan['gid'])) {
            @chgrp($temporary, $plan['gid']);
        }
        if (!@rename($temporary, $plan['path'])) {
            @unlink($temporary);
            throw new RuntimeException('Could not replace a gift file. Backup: ' . $backupDir);
        }
        $migratedFiles++;
    }

    echo 'Files migrated: ' . $migratedFiles . PHP_EOL;
    echo 'Backup directory: ' . $backupDir . PHP_EOL;
    echo "Encrypted payloads and IDs were left unchanged.\n";
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit(1);
} finally {
    @flock($lock, LOCK_UN);
    @fclose($lock);
}
