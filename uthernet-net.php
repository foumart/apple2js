<?php
/**
 * LAN address of the machine running the emulator relay.
 * Contiki's DHCP request is answered with these values, so the Apple
 * sits on this network instead of an invented subnet.
 *
 * Only a browser on this same machine gets an answer. Anyone else would
 * learn this server's internal addresses, and they are not on its LAN
 * anyway; they get null and the emulator uses a virtual network.
 */
require __DIR__ . '/uthernet-guard.php';
uthernet_guard('net');
header('Content-Type: application/json');

$config = uthernet_local_machine() ? lan_config() : null;
if ($config === null) {
    echo 'null';
    exit;
}
echo json_encode($config);

function lan_config()
{
    $text = shell_exec('ipconfig /all');
    if (is_string($text) && $text !== '') {
        return lan_config_windows($text);
    }
    $route = shell_exec('ip -4 route show default');
    $addr = shell_exec('ip -4 addr');
    if (is_string($route) && is_string($addr)) {
        return lan_config_linux($route, $addr);
    }
    return null;
}

function lan_config_windows($text)
{
    $best = null;
    $bestScore = -1;
    foreach (preg_split("/\r?\n(?=[^\r\n]*adapter )/i", $text) as $block) {
        if (stripos($block, 'adapter') === false) {
            continue;
        }
        if (stripos($block, 'Media disconnected') !== false) {
            continue;
        }
        if (!preg_match('/IPv4 Address[^:]*:\s*([0-9.]+)/', $block, $ip)) {
            continue;
        }
        if (!preg_match('/Subnet Mask[^:]*:\s*([0-9.]+)/', $block, $mask)) {
            continue;
        }
        if (!preg_match_all('/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $block, $all)) {
            continue;
        }
        $gateway = ipv4_after($block, 'Default Gateway');
        $dns = ipv4_after($block, 'DNS Servers');
        if ($gateway === null) {
            continue;
        }
        if ($dns === null) {
            $dns = $gateway;
        }
        $score = 0;
        if (stripos($block, 'Ethernet adapter') !== false && stripos($block, 'Bluetooth') === false) {
            $score += 2;
        }
        if (stripos($block, 'Wi-Fi') !== false || stripos($block, 'Wireless') !== false) {
            $score += 1;
        }
        if ($score > $bestScore) {
            $bestScore = $score;
            $best = array(
                'ip' => $ip[1],
                'mask' => $mask[1],
                'gateway' => $gateway,
                'dns' => $dns,
            );
        }
    }
    return $best;
}

function ipv4_after($block, $label)
{
    $at = stripos($block, $label);
    if ($at === false) {
        return null;
    }
    $rest = substr($block, $at);
    $end = stripos($rest, "\n", 1);
    $window = $end === false ? $rest : substr($rest, 0, $end + 80);
    if (preg_match('/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $window, $match)) {
        return $match[1];
    }
    return null;
}

function lan_config_linux($route, $addr)
{
    if (!preg_match('/default via ([0-9.]+) dev (\S+)/', $route, $routeMatch)) {
        return null;
    }
    $dev = $routeMatch[2];
    $section = $addr;
    $pos = strpos($addr, $dev);
    if ($pos !== false) {
        $section = substr($addr, $pos);
    }
    if (!preg_match('/inet ([0-9.]+)\/(\d+)/', $section, $inet)) {
        return null;
    }
    return array(
        'ip' => $inet[1],
        'mask' => prefix_to_mask(intval($inet[2])),
        'gateway' => $routeMatch[1],
        'dns' => $routeMatch[1],
    );
}

function prefix_to_mask($prefix)
{
    $bits = $prefix > 0 ? (0xffffffff << (32 - $prefix)) & 0xffffffff : 0;
    return long2ip($bits);
}
