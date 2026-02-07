/**
 * ONVIF Camera Discovery & Management Service
 *
 * Uses raw UDP multicast WS-Discovery for camera discovery
 * and raw SOAP HTTP requests for device info / stream URI / profiles.
 * Digest auth is implemented manually (no external xml2js / onvif-nvt deps).
 */

import * as dgram from 'dgram';
import * as crypto from 'crypto';
import * as http from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredOnvifDevice {
  address: string;
  port: number;
  name: string;
  manufacturer: string;
  model: string;
  streamUri: string;
}

export interface OnvifDeviceInfo {
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  serialNumber: string;
  hardwareId: string;
}

export interface OnvifMediaProfile {
  token: string;
  name: string;
  videoEncoderToken?: string;
  videoSourceToken?: string;
  ptzToken?: string;
}

// ---------------------------------------------------------------------------
// Helpers – XML extraction via regex (no xml2js dependency)
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string {
  // Handles both namespaced (tds:Model) and non-namespaced (Model) tags
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>[\\s\\S]*?</(?:[\\w-]+:)?${tag}>`, 'gi');
  return xml.match(re) || [];
}

function extractAttribute(xml: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// WS-Discovery – UDP multicast
// ---------------------------------------------------------------------------

const WS_DISCOVERY_MULTICAST = '239.255.255.250';
const WS_DISCOVERY_PORT = 3702;

function buildDiscoveryProbe(): string {
  const messageId = `urn:uuid:${crypto.randomUUID()}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
    '  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"',
    '  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"',
    '  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">',
    '  <s:Header>',
    `    <a:MessageID>${messageId}</a:MessageID>`,
    '    <a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>',
    '    <a:To s:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>',
    '    <d:AppSequence InstanceId="1" MessageNumber="1"/>',
    '  </s:Header>',
    '  <s:Body>',
    '    <d:Probe>',
    '      <d:Types>dn:NetworkVideoTransmitter</d:Types>',
    '    </d:Probe>',
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

function parseXAddrs(xml: string): { address: string; port: number } | null {
  const xaddrs = extractTag(xml, 'XAddrs');
  if (!xaddrs) return null;

  // XAddrs can contain multiple space-separated URIs; pick the first http one
  const uris = xaddrs.split(/\s+/);
  for (const uri of uris) {
    try {
      const url = new URL(uri);
      return {
        address: url.hostname,
        port: parseInt(url.port, 10) || 80,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Discover ONVIF cameras on the local network via WS-Discovery multicast.
 * @param timeout Discovery window in milliseconds (default 5000).
 */
export async function discoverCameras(timeout = 5000): Promise<DiscoveredOnvifDevice[]> {
  return new Promise((resolve) => {
    const devices = new Map<string, DiscoveredOnvifDevice>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      console.error('[ONVIF Discovery] Socket error:', err.message);
      socket.close();
      resolve([]);
    });

    socket.on('message', (msg, rinfo) => {
      try {
        const xml = msg.toString();
        const parsed = parseXAddrs(xml);
        const address = parsed?.address || rinfo.address;
        const port = parsed?.port || 80;
        const key = `${address}:${port}`;

        if (!devices.has(key)) {
          // Try to extract device scopes for name/manufacturer/model
          const scopes = extractTag(xml, 'Scopes');
          let name = 'ONVIF Camera';
          let manufacturer = '';
          let model = '';

          if (scopes) {
            const scopeList = scopes.split(/\s+/);
            for (const scope of scopeList) {
              if (scope.includes('onvif://www.onvif.org/name/')) {
                name = decodeURIComponent(scope.split('/name/')[1] || '') || name;
              }
              if (scope.includes('onvif://www.onvif.org/hardware/')) {
                model = decodeURIComponent(scope.split('/hardware/')[1] || '');
              }
              if (scope.includes('onvif://www.onvif.org/manufacturer/')) {
                manufacturer = decodeURIComponent(scope.split('/manufacturer/')[1] || '');
              }
            }
          }

          devices.set(key, {
            address,
            port,
            name,
            manufacturer,
            model,
            streamUri: `rtsp://${address}:554/Streaming/Channels/101`,
          });
        }
      } catch (err) {
        console.error('[ONVIF Discovery] Parse error:', err);
      }
    });

    socket.bind(0, () => {
      socket.addMembership(WS_DISCOVERY_MULTICAST);

      const probeBuffer = Buffer.from(buildDiscoveryProbe());
      socket.send(probeBuffer, 0, probeBuffer.length, WS_DISCOVERY_PORT, WS_DISCOVERY_MULTICAST);

      // Send a second probe after a short delay for reliability
      setTimeout(() => {
        try {
          socket.send(probeBuffer, 0, probeBuffer.length, WS_DISCOVERY_PORT, WS_DISCOVERY_MULTICAST);
        } catch {
          // socket may have closed
        }
      }, 500);
    });

    setTimeout(() => {
      try {
        socket.dropMembership(WS_DISCOVERY_MULTICAST);
      } catch {
        // ignore
      }
      socket.close();
      resolve(Array.from(devices.values()));
    }, timeout);
  });
}

// ---------------------------------------------------------------------------
// ONVIF SOAP requests with HTTP Digest Auth
// ---------------------------------------------------------------------------

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string;
}

function parseDigestChallenge(wwwAuthenticate: string): DigestChallenge | null {
  if (!wwwAuthenticate.toLowerCase().startsWith('digest')) return null;

  const realmMatch = wwwAuthenticate.match(/realm="([^"]*)"/i);
  const nonceMatch = wwwAuthenticate.match(/nonce="([^"]*)"/i);
  const qopMatch = wwwAuthenticate.match(/qop="([^"]*)"/i);

  return {
    realm: realmMatch?.[1] || '',
    nonce: nonceMatch?.[1] || '',
    qop: qopMatch?.[1] || 'auth',
  };
}

function buildDigestHeader(
  method: string,
  uri: string,
  username: string,
  password: string,
  challenge: DigestChallenge,
  nc: number
): string {
  const ncHex = nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = crypto
    .createHash('md5')
    .update(`${username}:${challenge.realm}:${password}`)
    .digest('hex');
  const ha2 = crypto
    .createHash('md5')
    .update(`${method}:${uri}`)
    .digest('hex');
  const response = crypto
    .createHash('md5')
    .update(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:auth:${ha2}`)
    .digest('hex');

  return [
    `Digest username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `qop=auth`,
    `nc=${ncHex}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ].join(', ');
}

/**
 * Build ONVIF WS-Security UsernameToken header for SOAP requests.
 * Many cameras accept WS-Security auth in the SOAP header as an alternative to HTTP Digest.
 */
function buildWsSecurityHeader(username: string, password: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)]))
    .digest('base64');

  return [
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">',
    '  <UsernameToken>',
    `    <Username>${username}</Username>`,
    `    <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>`,
    `    <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>`,
    `    <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>`,
    '  </UsernameToken>',
    '</Security>',
  ].join('\n');
}

/**
 * Send a SOAP request to an ONVIF service endpoint.
 * Tries WS-Security auth in the SOAP header first; falls back to HTTP Digest.
 */
async function soapRequest(
  host: string,
  port: number,
  path: string,
  soapBody: string,
  username?: string,
  password?: string
): Promise<string> {
  const wsSecHeader = username && password
    ? buildWsSecurityHeader(username, password)
    : '';

  const envelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
    '  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"',
    '  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"',
    '  xmlns:tt="http://www.onvif.org/ver10/schema"',
    '  xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">',
    '  <s:Header>',
    wsSecHeader,
    '  </s:Header>',
    '  <s:Body>',
    soapBody,
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');

  // First attempt – with WS-Security header (no HTTP auth)
  let response = await httpPost(host, port, path, envelope);

  // If we get 401, retry with HTTP Digest auth
  if (response.statusCode === 401 && username && password) {
    const wwwAuth = response.headers['www-authenticate'] as string | undefined;
    if (wwwAuth) {
      const challenge = parseDigestChallenge(wwwAuth);
      if (challenge) {
        const authHeader = buildDigestHeader('POST', path, username, password, challenge, 1);
        response = await httpPost(host, port, path, envelope, authHeader);
      }
    }
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `ONVIF SOAP request failed: HTTP ${response.statusCode} – ${response.body.slice(0, 200)}`
    );
  }

  return response.body;
}

function httpPost(
  host: string,
  port: number,
  path: string,
  body: string,
  authorization?: string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body).toString(),
    };
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const req = http.request(
      { hostname: host, port, path, method: 'POST', headers, timeout: 10000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ONVIF request timed out: ${host}:${port}${path}`));
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Public API – device info, profiles, stream URI
// ---------------------------------------------------------------------------

/**
 * Get device information from an ONVIF camera.
 */
export async function getDeviceInfo(
  host: string,
  port: number,
  username?: string,
  password?: string
): Promise<OnvifDeviceInfo> {
  const soapBody = '<tds:GetDeviceInformation/>';
  const xml = await soapRequest(host, port, '/onvif/device_service', soapBody, username, password);

  return {
    manufacturer: extractTag(xml, 'Manufacturer'),
    model: extractTag(xml, 'Model'),
    firmwareVersion: extractTag(xml, 'FirmwareVersion'),
    serialNumber: extractTag(xml, 'SerialNumber'),
    hardwareId: extractTag(xml, 'HardwareId'),
  };
}

/**
 * Get media profiles from an ONVIF camera.
 */
export async function getProfiles(
  host: string,
  port: number,
  username?: string,
  password?: string
): Promise<OnvifMediaProfile[]> {
  const soapBody = '<trt:GetProfiles/>';
  const xml = await soapRequest(host, port, '/onvif/media_service', soapBody, username, password);

  const profileBlocks = extractAllBlocks(xml, 'Profiles');
  return profileBlocks.map((block) => ({
    token: extractAttribute(block, 'token'),
    name: extractTag(block, 'Name'),
    videoEncoderToken: extractAttribute(
      extractAllBlocks(block, 'VideoEncoderConfiguration')[0] || '',
      'token'
    ) || undefined,
    videoSourceToken: extractAttribute(
      extractAllBlocks(block, 'VideoSourceConfiguration')[0] || '',
      'token'
    ) || undefined,
    ptzToken: extractAttribute(
      extractAllBlocks(block, 'PTZConfiguration')[0] || '',
      'token'
    ) || undefined,
  }));
}

/**
 * Get the RTSP stream URI for a given ONVIF camera.
 * If no profile token is given, the first profile is used.
 */
export async function getStreamUri(
  host: string,
  port: number,
  username?: string,
  password?: string,
  profileToken?: string
): Promise<string> {
  // Resolve profile token if not provided
  let token = profileToken;
  if (!token) {
    const profiles = await getProfiles(host, port, username, password);
    if (profiles.length === 0) {
      throw new Error('No media profiles found on device');
    }
    token = profiles[0].token;
  }

  const soapBody = [
    '<trt:GetStreamUri>',
    '  <trt:StreamSetup>',
    '    <tt:Stream>RTP-Unicast</tt:Stream>',
    '    <tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>',
    '  </trt:StreamSetup>',
    `  <trt:ProfileToken>${token}</trt:ProfileToken>`,
    '</trt:GetStreamUri>',
  ].join('\n');

  const xml = await soapRequest(host, port, '/onvif/media_service', soapBody, username, password);
  const uri = extractTag(xml, 'Uri');

  if (!uri) {
    throw new Error('Failed to extract stream URI from ONVIF response');
  }

  return uri;
}
