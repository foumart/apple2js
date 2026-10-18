<?php
/**
 * Loads a public HTTP or HTTPS URL for the emulated Uthernet II.
 * The Apple asks for a TCP connection. The browser cannot open one, and it
 * cannot read most other websites, so this script fetches the URL and
 * returns the body. Private and loopback addresses are refused.
 */
header('Cache-Control: no-store');

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
            CURLOPT_TIMEOUT => 20,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_MAXFILESIZE => 8 * 1024 * 1024,
            CURLOPT_USERAGENT => 'apple2js-uthernet',
            CURLOPT_RESOLVE => array($pin['resolve']),
        ));
        $raw = curl_exec($ch);
        if ($raw === false) {
            curl_close($ch);
            return null;
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
        return array('status' => $status, 'data' => $data);
    }
    return null;
}

function public_endpoint($url)
{
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
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
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
