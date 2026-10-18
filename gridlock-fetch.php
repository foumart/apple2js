<?php
/**
 * Same-origin stand-in for the GridLock stage host.
 * The browser blocks http://a2.foumartgames.com from http://localhost.
 * This file fetches that one host and returns the body.
 */
header('Cache-Control: no-store');

$url = isset($_GET['url']) ? $_GET['url'] : '';
$parts = parse_url($url);
$scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
$host = isset($parts['host']) ? strtolower($parts['host']) : '';
$path = isset($parts['path']) ? $parts['path'] : '';

if (
    $scheme !== 'http' ||
    $host !== 'a2.foumartgames.com' ||
    strpos($path, '/gridlock/') !== 0
) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo 'refused';
    exit;
}

if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: text/plain');
    echo 'curl missing';
    exit;
}

$ch = curl_init($url);
curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_USERAGENT => 'apple2js-uthernet',
));
$raw = curl_exec($ch);
if ($raw === false) {
    http_response_code(502);
    header('Content-Type: text/plain');
    echo curl_error($ch);
    curl_close($ch);
    exit;
}
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerLen = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

http_response_code($status ? $status : 502);
header('Content-Type: application/octet-stream');
echo substr($raw, $headerLen);
