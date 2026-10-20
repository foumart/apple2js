<?php
/**
 * Resolves one hostname for the emulated Contiki DNS client.
 * The Apple receives the real address, and the following HTTP request
 * is still fetched by this host. Names that resolve to private or loopback
 * addresses are reported as missing, so this server's own network cannot
 * be mapped through it.
 */
require __DIR__ . '/uthernet-guard.php';
uthernet_guard('dns');
header('Content-Type: text/plain');

$name = isset($_GET['name']) ? $_GET['name'] : '';
if (strlen($name) > 253 || !preg_match('/^[A-Za-z0-9.-]+$/', $name) || strpos($name, '..') !== false) {
    http_response_code(400);
    exit;
}

$ips = gethostbynamel($name);
if (!$ips) {
    http_response_code(404);
    exit;
}
foreach ($ips as $ip) {
    if (!uthernet_public_ip($ip)) {
        http_response_code(404);
        exit;
    }
}
echo $ips[0];
