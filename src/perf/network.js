import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect } from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { isLocalUrl } from '../capture/helpers.js';

export function isLoopbackAddress(address) {
  return address === '::1' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)
    || /^::ffff:127\.(?:\d{1,3}\.){2}\d{1,3}$/i.test(address);
}

// R6.16: a local side must resolve only to loopback. The runner pins the host to the
// first address, so a later DNS answer cannot move it (#383).
export async function resolveLocalAddress(url, resolver = lookup) {
  if (!isLocalUrl(url.href) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Performance accepts a local HTTP or HTTPS origin only.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await resolver(host, { all: true });
  if (!addresses.length || addresses.some(entry => !isLoopbackAddress(entry.address))) throw new Error('Performance DNS must resolve only to loopback.');
  return addresses[0].address;
}

// The SHA-256 of the public key of a local HTTPS origin. Chrome then accepts this one
// certificate (self-signed or mkcert) and still verifies every other certificate (R3.9).
export function localCertificateSpki(url, address, { timeout = 10000 } = {}) {
  const servername = isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port: Number(url.port || 443), servername, rejectUnauthorized: false, timeout }, () => {
      try {
        const raw = socket.getPeerCertificate()?.raw;
        if (!raw) throw new Error('no certificate');
        const der = new X509Certificate(raw).publicKey.export({ type: 'spki', format: 'der' });
        resolve(createHash('sha256').update(der).digest('base64'));
      } catch { reject(new Error('The local HTTPS origin sends no readable certificate.')); }
      finally { socket.end(); }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('The local HTTPS origin does not answer.')); });
    socket.on('error', () => reject(new Error('The local HTTPS origin does not answer.')));
  });
}
