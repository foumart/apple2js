<?php
/**
 * Resolves one hostname for the emulated Contiki DNS client.
 * The Apple receives the real address, and the following HTTP request
 * is still fetched by this host.
 */
header('Cache-Control: no-store');
header('Content-Type: text/plain');

$name = isset($_GET['name']) ? $_GET['name'] : '';
if (!preg_match('/^[A-Za-z0-9.-]+$/', $name) || strpos($name, '..') !== false) {
    http_response_code(400);
    exit;
}

$ips = gethostbynamel($name);
if (!$ips) {
    http_response_code(404);
    exit;
}
echo $ips[0];
