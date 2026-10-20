<?php
/**
 * Loads a public HTTP or HTTPS URL for the emulated Uthernet II.
 * The Apple asks for a TCP connection. The browser cannot open one, and it
 * cannot read most other websites, so this script fetches the URL and
 * returns the body. Private and loopback addresses are refused.
 *
 * The body is always sent as application/octet-stream and the site's own
 * type goes in X-Uthernet-Type. Passing an HTML page through as text/html
 * would run that page's scripts on this site's origin.
 */
require __DIR__ . '/uthernet-guard.php';
uthernet_guard('fetch');

const UTHERNET_MAX_BYTES = 8388608;

$url = isset($_GET['url']) ? $_GET['url'] : '';
$body = load_public_url($url);
if ($body === null) {
    http_response_code(403);
    header('Content-Type: text/plain');
    echo 'refused';
    exit;
}

http_response_code($body['status'] ? $body['status'] : 502);
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment');
header("Content-Security-Policy: default-src 'none'; sandbox");
header('X-Uthernet-Type: ' . $body['type']);
echo $body['data'];

function load_public_url($url)
{
    if (!function_exists('curl_init')) {
        return null;
    }
    for ($hop = 0; $hop < 5; $hop++) {
        $pin = public_endpoint($url);
        if ($pin === null) {
            return null;
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_PROXY => '',
            CURLOPT_MAXFILESIZE => UTHERNET_MAX_BYTES,
            // MAXFILESIZE only sees a Content-Length; this also stops a
            // chunked or unannounced body.
            CURLOPT_NOPROGRESS => false,
            CURLOPT_PROGRESSFUNCTION => function ($ch, $total, $now) {
                return $now > UTHERNET_MAX_BYTES ? 1 : 0;
            },
            CURLOPT_USERAGENT => 'apple2js-uthernet',
            CURLOPT_RESOLVE => array($pin['resolve']),
        ));
        $raw = curl_exec($ch);
        if ($raw === false) {
            curl_close($ch);
            return array('status' => 502, 'data' => '', 'type' => 'text/plain');
        }
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerLen = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        $headers = substr($raw, 0, $headerLen);
        $data = substr($raw, $headerLen);
        if ($status >= 300 && $status < 400 && preg_match('/^Location:\s*(\S+)/mi', $headers, $match)) {
            $url = resolve_redirect($url, $match[1]);
            continue;
        }
        $type = 'application/octet-stream';
        if (preg_match('/^Content-Type:\s*([^\r\n]+)/mi', $headers, $typeMatch)) {
            $type = substr(preg_replace('/[^\x20-\x7e]/', '', trim($typeMatch[1])), 0, 200);
        }
        return array('status' => $status, 'data' => $data, 'type' => $type);
    }
    return null;
}

function public_endpoint($url)
{
    // Spaces, backslashes and control bytes are where PHP's and curl's
    // URL parsers disagree about the host.
    if (!is_string($url) || $url === '' || preg_match('/[^\x21-\x7e]|\\\\/', $url)) {
        return null;
    }
    $parts = parse_url($url);
    if (!$parts) {
        return null;
    }
    $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : '';
    $host = isset($parts['host']) ? $parts['host'] : '';
    if (($scheme !== 'http' && $scheme !== 'https') || $host === '' || isset($parts['user'])) {
        return null;
    }
    $port = isset($parts['port']) ? intval($parts['port']) : ($scheme === 'https' ? 443 : 80);
    if ($port !== 80 && $port !== 443) {
        return null;
    }
    $names = @gethostbynamel($host);
    if (!$names) {
        return null;
    }
    foreach ($names as $ip) {
        if (!uthernet_public_ip($ip)) {
            return null;
        }
    }
    return array('resolve' => $host . ':' . $port . ':' . $names[0]);
}

function resolve_redirect($base, $location)
{
    if (preg_match('#^https?://#i', $location)) {
        return $location;
    }
    $parts = parse_url($base);
    if (substr($location, 0, 2) === '//') {
        return $parts['scheme'] . ':' . $location;
    }
    $origin = $parts['scheme'] . '://' . $parts['host'];
    if (isset($parts['port'])) {
        $origin .= ':' . $parts['port'];
    }
    if (isset($location[0]) && $location[0] === '/') {
        return $origin . $location;
    }
    $path = isset($parts['path']) ? $parts['path'] : '/';
    $dir = substr($path, 0, strrpos($path, '/') + 1);
    return $origin . $dir . $location;
}
