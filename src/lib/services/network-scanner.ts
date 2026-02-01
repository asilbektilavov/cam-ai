import * as net from 'net';
import * as os from 'os';

export interface DiscoveredCamera {
  ip: string;
  ports: number[];
  protocol: 'rtsp' | 'http' | 'unknown';
  suggestedUrl: string;
  brand?: string;
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

const SCAN_TIMEOUT = 500;
const MAX_CONCURRENT = 50;

function getLocalSubnet(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        return parts.slice(0, 3).join('.');
      }
    }
  }
  return null;
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

function guessBrand(ports: number[]): string | undefined {
  if (ports.includes(37777)) return 'Dahua';
  if (ports.includes(34567)) return 'XMeye/NVR';
  if (ports.includes(8080) && !ports.includes(554)) return 'IP Webcam';
  if (ports.includes(554) && ports.includes(80)) return 'IP Camera';
  if (ports.includes(554)) return 'RTSP Camera';
  return undefined;
}

function buildSuggestedUrl(ip: string, ports: number[], brand?: string): string {
  if (brand === 'IP Webcam' || (ports.includes(8080) && !ports.includes(554))) {
    return `http://${ip}:8080`;
  }
  if (brand === 'Dahua') {
    return `rtsp://admin:admin@${ip}:554/cam/realmonitor?channel=1&subtype=0`;
  }
  if (ports.includes(554)) {
    return `rtsp://admin:admin@${ip}:554/Streaming/Channels/101`;
  }
  if (ports.includes(8554)) {
    return `rtsp://${ip}:8554/stream`;
  }
  return `http://${ip}:${ports[0]}`;
}

export async function discoverCameras(): Promise<DiscoveredCamera[]> {
  const subnet = getLocalSubnet();
  if (!subnet) {
    throw new Error('Не удалось определить подсеть');
  }

  const localAddresses = getLocalAddresses();
  const discovered: DiscoveredCamera[] = [];
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);

  for (let i = 0; i < ips.length; i += MAX_CONCURRENT) {
    const batch = ips.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map(async (ip) => {
        if (localAddresses.has(ip)) return { ip, openPorts: [] as number[] };
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
      if (openPorts.length > 0) {
        const brand = guessBrand(openPorts);
        const hasRtsp = openPorts.includes(554) || openPorts.includes(8554) || openPorts.includes(37777);
        const hasHttp = openPorts.includes(80) || openPorts.includes(8080);
        const protocol = hasRtsp ? 'rtsp' as const : hasHttp ? 'http' as const : 'unknown' as const;

        discovered.push({
          ip,
          ports: openPorts.sort((a, b) => a - b),
          protocol,
          suggestedUrl: buildSuggestedUrl(ip, openPorts, brand),
          brand,
        });
      }
    }
  }

  return discovered;
}
