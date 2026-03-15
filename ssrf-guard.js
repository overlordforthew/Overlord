/**
 * SSRF Prevention Guard (OpenCrow pattern)
 *
 * Validates URLs before fetching to prevent Server-Side Request Forgery.
 * DNS-resolves hostnames and checks resolved IPs against private ranges.
 */

import dns from 'dns/promises';
import { URL } from 'url';

// Private/internal IP ranges that should never be accessed
const PRIVATE_RANGES = [
  { prefix: '127.',     name: 'loopback' },
  { prefix: '10.',      name: 'private-A' },
  { prefix: '192.168.', name: 'private-C' },
  { prefix: '169.254.', name: 'link-local' },  // AWS metadata, APIPA
  { prefix: '0.',       name: 'unspecified' },
  { prefix: '::1',      name: 'ipv6-loopback' },
  { prefix: 'fe80:',    name: 'ipv6-link-local' },
  { prefix: 'fc00:',    name: 'ipv6-ula' },
  { prefix: 'fd',       name: 'ipv6-ula' },
];

// 172.16.0.0/12 — need range check
function isPrivate172(ip) {
  if (!ip.startsWith('172.')) return false;
  const second = parseInt(ip.split('.')[1], 10);
  return second >= 16 && second <= 31;
}

// 100.64.0.0/10 — CGNAT / Tailscale
function isCGNAT(ip) {
  if (!ip.startsWith('100.')) return false;
  const second = parseInt(ip.split('.')[1], 10);
  return second >= 64 && second <= 127;
}

function isPrivateIP(ip) {
  if (PRIVATE_RANGES.some(r => ip.startsWith(r.prefix))) return true;
  if (isPrivate172(ip)) return true;
  if (isCGNAT(ip)) return true;
  return false;
}

/**
 * Validate a URL is safe to fetch (no SSRF).
 * Resolves DNS and checks all IPs against private ranges.
 *
 * @param {string} url - URL to validate
 * @returns {Promise<{safe: boolean, reason?: string, resolvedIPs?: string[]}>}
 */
export async function validateURL(url) {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    // Resolve hostname to IPs
    const hostname = parsed.hostname;

    // Direct IP in URL — check immediately
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      if (isPrivateIP(hostname)) {
        return { safe: false, reason: `Blocked private IP: ${hostname}` };
      }
      return { safe: true, resolvedIPs: [hostname] };
    }

    // DNS resolution
    const addresses = await dns.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.resolve6(hostname).catch(() => []);
    const allIPs = [...addresses, ...addresses6];

    if (allIPs.length === 0) {
      return { safe: false, reason: `DNS resolution failed for: ${hostname}` };
    }

    // Check ALL resolved IPs — attacker could put a private IP in DNS
    for (const ip of allIPs) {
      if (isPrivateIP(ip)) {
        return { safe: false, reason: `DNS for ${hostname} resolves to private IP: ${ip}` };
      }
    }

    return { safe: true, resolvedIPs: allIPs };
  } catch (err) {
    return { safe: false, reason: `URL validation error: ${err.message}` };
  }
}

export { isPrivateIP };
