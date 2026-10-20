<?php
/**
 * Shared checks for the uthernet-*.php scripts.
 *
 * Origin, Sec-Fetch-Site and Referer keep other websites from using these
 * scripts through their visitors' browsers. They are not authentication:
 * any non-browser client can send the same headers. What actually limits
 * abuse is the per-address rate limit, the public-address check, and
 * uthernet-fetch.php handing pages back as inert bytes.
 */

function uthernet_guard($bucket)
{
    // Marks a response as coming from a script that ran. A static server
    // that returns this file's source does not send it.
    header('X-Uthernet: 1');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (uthernet_local_origin()) {
        // A page on a localhost dev server using this host as its relay.
        header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
        header('Access-Control-Expose-Headers: X-Uthernet, X-Uthernet-Type');
        header('Vary: Origin');
    } elseif (!uthernet_same_site()) {
        http_response_code(403);
        header('Content-Type: text/plain');
        echo 'refused';
        exit;
    }
    // uthernet-net.php answers other machines with null and does no work,
    // so it has no limit.
    $limits = array('dns' => 3, 'fetch' => 6);
    if (isset($limits[$bucket]) && !uthernet_local_machine()) {
        uthernet_rate_limit($bucket, $limits[$bucket], 60);
    }
}

/** True when the browser and this server are the same machine, as with XAMPP. */
function uthernet_local_machine()
{
    $addr = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
    $loopback = $addr === '::1' || preg_match('/^(::ffff:)?127\./', $addr);
    // A reverse proxy on this machine also connects from loopback, so the
    // Host header must name this machine too.
    $host = uthernet_request_host();
    return $loopback && ($host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]');
}

function uthernet_local_origin()
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    return preg_match('#^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$#', $origin) === 1;
}

function uthernet_same_site()
{
    $host = uthernet_request_host();
    if ($host === '') {
        return false;
    }
    $site = isset($_SERVER['HTTP_SEC_FETCH_SITE']) ? strtolower($_SERVER['HTTP_SEC_FETCH_SITE']) : '';
    if ($site === 'cross-site') {
        return false;
    }
    if ($site === 'same-origin' || $site === 'same-site') {
        return true;
    }
    $origin = uthernet_origin_host();
    if ($origin !== '') {
        return $origin === $host;
    }
    $referer = isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '';
    $parts = $referer !== '' ? parse_url($referer) : false;
    return is_array($parts) && !empty($parts['host']) && strtolower($parts['host']) === $host;
}

function uthernet_request_host()
{
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
    return strtolower(preg_replace('/:\d+$/', '', $host));
}

function uthernet_origin_host()
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    $parts = $origin !== '' ? parse_url($origin) : false;
    if (!is_array($parts) || empty($parts['host'])) {
        return '';
    }
    return strtolower($parts['host']);
}

function uthernet_rate_limit($bucket, $max, $window)
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0';
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'uthernet-rl';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $file = $dir . DIRECTORY_SEPARATOR . hash('sha256', $bucket . '|' . $ip);
    $handle = @fopen($file, 'c+');
    if ($handle === false) {
        return;
    }
    flock($handle, LOCK_EX);
    $decoded = json_decode((string) stream_get_contents($handle), true);
    $now = time();
    $kept = array();
    foreach (is_array($decoded) ? $decoded : array() as $hit) {
        if ($hit > $now - $window) {
            $kept[] = $hit;
        }
    }
    $busy = count($kept) >= $max;
    if (!$busy) {
        $kept[] = $now;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($kept));
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    if ($busy) {
        http_response_code(429);
        header('Content-Type: text/plain');
        echo 'busy';
        exit;
    }
}

/**
 * True for an IPv4 address on the public internet. Besides private and
 * loopback space this refuses carrier-grade NAT (100.64.0.0/10, also used
 * by Tailscale), benchmark and documentation ranges, and multicast, which
 * PHP before 8.2 lets through.
 */
function uthernet_public_ip($ip)
{
    $flags = FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
    if (defined('FILTER_FLAG_GLOBAL_RANGE')) {
        $flags |= FILTER_FLAG_GLOBAL_RANGE;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, $flags) === false) {
        return false;
    }
    $blocked = array(
        '0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24', '192.0.2.0/24',
        '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3',
    );
    $long = ip2long($ip);
    foreach ($blocked as $cidr) {
        list($net, $bits) = explode('/', $cidr);
        $mask = -1 << (32 - intval($bits));
        if (($long & $mask) === (ip2long($net) & $mask)) {
            return false;
        }
    }
    return true;
}
