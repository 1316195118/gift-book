<?php
/**
 * 连通性探针：回一个极小的 JSON，不读数据、不写文件，仅用于前端测延迟。
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Content-Length: 11');
http_response_code(200);
echo '{"ok":true}';
