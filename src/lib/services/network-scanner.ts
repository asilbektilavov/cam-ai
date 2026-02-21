import * as net from 'net';
import * as os from 'os';

export interface DiscoveredCamera {
  ip: string;
  ports: number[];
  protocol: 'rtsp' | 'http' | 'unknown';
  suggestedUrl: string;
  brand?: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  onvifSupported?: boolean;
}

const CAMERA_PORTS = [
  { port: 554, protocol: 'rtsp' as const },
  { port: 8554, protocol: 'rtsp' as const },
  { port: 80, protocol: 'http' as const },
  { port: 8080, protocol: 'http' as const },
  { port: 443, protocol: 'http' as const },
  { port: 37777, protocol: 'rtsp' as const }, // Dahua
  { port: 34567, protocol: 'rtsp' as const }, // Chinese NVR
];

const SCAN_TIMEOUT = 1000;
const MAX_CONCURRENT = 100;

// Virtual/tunnel interface prefixes to skip
const SKIP_PREFIXES = ['docker', 'veth', 'br-', 'utun', 'awdl', 'llw', 'ap', 'bridge', 'gif', 'stf', 'anpi', 'tailscale', 'dummy'];

function getAllSubnets(): string[] {
  const interfaces = os.networkInterfaces();
  const seen = new Set<string>();
  const subnets: string[] = [];

  for (const [name, iface] of Object.entries(interfaces)) {
    if (!iface) continue;
    if (SKIP_PREFIXES.some((p) => name.startsWith(p))) continue;

    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        const subnet = parts.slice(0, 3).join('.');
        // Skip link-local 169.254.x.x (no DHCP = unlikely camera subnet)
        if (subnet.startsWith('169.254')) continue;
        if (!seen.has(subnet)) {
          seen.add(subnet);
          subnets.push(subnet);
        }
      }
    }
  }
  return subnets;
}

function getLocalAddresses(): Set<string> {
  const addresses = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4') addresses.add(addr.address);
    }
  }
  return addresses;
}

function getGatewayAddresses(subnets: string[]): Set<string> {
  const gateways = new Set<string>();
  for (const subnet of subnets) {
    gateways.add(`${subnet}.1`);
    gateways.add(`${subnet}.254`);
  }
  return gateways;
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(SCAN_TIMEOUT);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

async function checkPortSlow(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.connect(port, ip);
  });
}

function guessBrand(ports: number[]): string | undefined {
  if (ports.includes(37777)) return 'Dahua';
  if (ports.includes(34567)) return 'XMeye/NVR';
  if (ports.includes(8080) && !ports.includes(554)) return 'IP Webcam';
  if (ports.includes(554) && ports.includes(80)) return 'IP Camera';
  if (ports.includes(554)) return 'RTSP Camera';
  return undefined;
}

// Common default credentials for IP cameras
const DEFAULT_CREDENTIALS = [
  { user: 'admin', pass: 'admin' },
  { user: 'admin', pass: '' },
  { user: 'admin', pass: '12345' },
];

// Common RTSP paths to probe (ordered by popularity)
const RTSP_PATHS = [
  '/Streaming/Channels/101',   // Hikvision
  '/stream1',                  // Generic / Chinese cameras
  '/cam/realmonitor?channel=1&subtype=0', // Dahua
  '/live/main',                // Trassir
  '/h264Preview_01_main',      // Dahua alt
  '/live/ch00_1',              // Uniview
  '/MediaInput/h264',          // Axis
  '/1',                        // Simple path
  '/live',                     // Generic
];

interface RtspProbeResult {
  path: string;
  user: string;
  pass: string;
}

async function probeRtsp(ip: string, port: number, user: string, pass: string): Promise<RtspProbeResult | null> {
  for (const path of RTSP_PATHS) {
    try {
      const cred = pass ? `${user}:${pass}` : user;
      const url = `rtsp://${cred}@${ip}:${port}${path}`;
      // Use DESCRIBE (not OPTIONS) — OPTIONS returns 200 for any path on many cameras.
      // DESCRIBE returns SDP only for valid streams and proper 401 for auth failures.
      const ok = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        let responded = false;
        let buf = '';
        socket.once('connect', () => {
          socket.write(`DESCRIBE ${url} RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\n\r\n`);
        });
        socket.on('data', (data) => {
          buf += data.toString();
          // Check for non-200 status early (401, 404, etc.)
          if (buf.includes('RTSP/1.0 4') || buf.includes('RTSP/1.0 5')) {
            responded = true;
            socket.destroy();
            resolve(false);
            return;
          }
          // For 200 OK, wait until we have SDP body (m=video/m=audio lines)
          const is200 = buf.includes('RTSP/1.0 200');
          const hasSdp = buf.includes('m=video') || buf.includes('m=audio');
          if (is200 && hasSdp) {
            responded = true;
            socket.destroy();
            resolve(true);
          }
        });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.once('close', () => { if (!responded) resolve(false); });
        socket.connect(port, ip);
      });
      if (ok) return { path, user, pass };
    } catch {
      continue;
    }
  }
  return null;
}

async function probeRtspPath(ip: string, port: number, customUser?: string, customPass?: string): Promise<RtspProbeResult | null> {
  // If custom credentials provided, try them first
  const creds = customUser
    ? [{ user: customUser, pass: customPass || '' }, ...DEFAULT_CREDENTIALS]
    : DEFAULT_CREDENTIALS;

  for (const { user, pass } of creds) {
    const result = await probeRtsp(ip, port, user, pass);
    if (result) return result;
  }
  return null;
}

function buildSuggestedUrl(ip: string, ports: number[], brand?: string, probe?: RtspProbeResult | null): string {
  if (brand === 'IP Webcam' || (ports.includes(8080) && !ports.includes(554))) {
    return `http://${ip}:8080/video`;
  }
  if (ports.includes(554)) {
    const path = probe?.path || (brand === 'Dahua' ? '/cam/realmonitor?channel=1&subtype=0' : '/Streaming/Channels/101');
    const user = probe?.user || 'admin';
    const pass = probe?.pass || '';
    const cred = pass ? `${user}:${pass}` : user;
    return `rtsp://${cred}@${ip}:554${path}`;
  }
  if (ports.includes(8554)) {
    return `rtsp://${ip}:8554/stream`;
  }
  return `http://${ip}:${ports[0]}`;
}

export async function discoverCameras(customUser?: string, customPass?: string): Promise<DiscoveredCamera[]> {
  const subnets = getAllSubnets();
  if (subnets.length === 0) {
    throw new Error('Не удалось определить подсеть');
  }

  const localAddresses = getLocalAddresses();
  const gatewayAddresses = getGatewayAddresses(subnets);
  const discovered: DiscoveredCamera[] = [];
  const seenIps = new Set<string>();

  // Build flat IP list from all subnets (skip local + gateway addresses)
  const allIps: string[] = [];
  for (const subnet of subnets) {
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`;
      if (!localAddresses.has(ip) && !gatewayAddresses.has(ip) && !seenIps.has(ip)) {
        seenIps.add(ip);
        allIps.push(ip);
      }
    }
  }

  for (let i = 0; i < allIps.length; i += MAX_CONCURRENT) {
    const batch = allIps.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map(async (ip) => {
        const openPorts: number[] = [];
        await Promise.all(
          CAMERA_PORTS.map(async ({ port }) => {
            if (await checkPort(ip, port)) {
              openPorts.push(port);
            }
          })
        );
        return { ip, openPorts };
      })
    );

    for (const { ip, openPorts } of results) {
      if (openPorts.length === 0) continue;

      let hasRtsp = openPorts.includes(554) || openPorts.includes(8554) || openPorts.includes(37777);
      const hasHttp8080 = openPorts.includes(8080);

      // If device has port 80 but no RTSP detected, retry port 554 with longer timeout
      // Many IP cameras respond slowly on RTSP port
      if (!hasRtsp && openPorts.includes(80)) {
        const rtspOpen = await checkPortSlow(ip, 554);
        if (rtspOpen) {
          openPorts.push(554);
          hasRtsp = true;
        }
      }

      // Skip devices with only port 80/443 and no RTSP and no 8080 — likely routers/printers/NAS
      if (!hasRtsp && !hasHttp8080 && openPorts.every((p) => p === 80 || p === 443)) {
        continue;
      }

      const brand = guessBrand(openPorts);
      const hasHttp = openPorts.includes(80) || hasHttp8080;
      const protocol = hasRtsp ? 'rtsp' as const : hasHttp ? 'http' as const : 'unknown' as const;

      // Probe RTSP paths + credentials to find working combination
      let probe: RtspProbeResult | null = null;
      if (openPorts.includes(554)) {
        probe = await probeRtspPath(ip, 554, customUser, customPass);
      }

      discovered.push({
        ip,
        ports: openPorts.sort((a, b) => a - b),
        protocol,
        suggestedUrl: buildSuggestedUrl(ip, openPorts, brand, probe),
        brand,
        name: brand || 'Камера',
      });
    }
  }

  return discovered;
}
