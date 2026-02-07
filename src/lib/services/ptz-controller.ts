/**
 * PTZ (Pan-Tilt-Zoom) Controller Service
 *
 * Sends ONVIF PTZ SOAP commands to cameras for directional movement,
 * zoom, preset navigation, and preset listing.
 * Uses ContinuousMove + Stop for smooth control.
 */

import * as crypto from 'crypto';
import * as http from 'http';
import { getProfiles } from './onvif-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PtzDirection = 'up' | 'down' | 'left' | 'right' | 'zoomIn' | 'zoomOut' | 'stop';

export interface PtzPreset {
  token: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Internal – SOAP + Auth helpers (mirrors onvif-manager but scoped to PTZ)
// ---------------------------------------------------------------------------

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

function buildDigestAuthHeader(
  method: string,
  uri: string,
  username: string,
  password: string,
  challenge: DigestChallenge,
  nc: number
): string {
  const ncHex = nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = crypto.createHash('md5').update(`${username}:${challenge.realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
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
      reject(new Error(`PTZ request timed out: ${host}:${port}${path}`));
    });
    req.write(body);
    req.end();
  });
}

async function ptzSoapRequest(
  host: string,
  port: number,
  soapBody: string,
  username: string,
  password: string
): Promise<string> {
  const path = '/onvif/ptz_service';
  const wsSecHeader = buildWsSecurityHeader(username, password);

  const envelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
    '  xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"',
    '  xmlns:tt="http://www.onvif.org/ver10/schema">',
    '  <s:Header>',
    wsSecHeader,
    '  </s:Header>',
    '  <s:Body>',
    soapBody,
    '  </s:Body>',
    '</s:Envelope>',
  ].join('\n');

  let response = await httpPost(host, port, path, envelope);

  // Retry with HTTP Digest if WS-Security is not accepted
  if (response.statusCode === 401) {
    const wwwAuth = response.headers['www-authenticate'] as string | undefined;
    if (wwwAuth) {
      const challenge = parseDigestChallenge(wwwAuth);
      if (challenge) {
        const authHeader = buildDigestAuthHeader('POST', path, username, password, challenge, 1);
        response = await httpPost(host, port, path, envelope, authHeader);
      }
    }
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `PTZ SOAP request failed: HTTP ${response.statusCode} – ${response.body.slice(0, 200)}`
    );
  }

  return response.body;
}

// ---------------------------------------------------------------------------
// XML extraction helpers
// ---------------------------------------------------------------------------

function extractTag(xml: string, tag: string): string {
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
// Resolve the first PTZ-capable profile token
// ---------------------------------------------------------------------------

async function resolvePtzProfileToken(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<string> {
  const profiles = await getProfiles(host, port, username, password);
  // Prefer a profile that has a PTZ configuration
  const ptzProfile = profiles.find((p) => p.ptzToken) || profiles[0];
  if (!ptzProfile) {
    throw new Error('No media profiles found on camera');
  }
  return ptzProfile.token;
}

// ---------------------------------------------------------------------------
// Direction → velocity mapping
// ---------------------------------------------------------------------------

interface PtzVelocity {
  panX: number;
  tiltY: number;
  zoomZ: number;
}

function directionToVelocity(direction: PtzDirection, speed: number): PtzVelocity {
  const s = Math.min(Math.max(speed, 0), 1); // clamp 0..1
  switch (direction) {
    case 'up':
      return { panX: 0, tiltY: s, zoomZ: 0 };
    case 'down':
      return { panX: 0, tiltY: -s, zoomZ: 0 };
    case 'left':
      return { panX: -s, tiltY: 0, zoomZ: 0 };
    case 'right':
      return { panX: s, tiltY: 0, zoomZ: 0 };
    case 'zoomIn':
      return { panX: 0, tiltY: 0, zoomZ: s };
    case 'zoomOut':
      return { panX: 0, tiltY: 0, zoomZ: -s };
    case 'stop':
    default:
      return { panX: 0, tiltY: 0, zoomZ: 0 };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Default duration (ms) for a ContinuousMove before auto-stop. */
const DEFAULT_MOVE_DURATION_MS = 500;

/**
 * Move the camera in a given direction at the specified speed.
 * Uses ONVIF ContinuousMove → waits → Stop for smooth control.
 * For 'stop' direction, sends Stop immediately.
 *
 * @param speed 0.0 – 1.0 (default 0.5)
 * @param durationMs How long to move before auto-stopping (default 500ms). Ignored for 'stop'.
 */
export async function move(
  host: string,
  port: number,
  username: string,
  password: string,
  direction: PtzDirection,
  speed = 0.5,
  durationMs = DEFAULT_MOVE_DURATION_MS
): Promise<void> {
  const profileToken = await resolvePtzProfileToken(host, port, username, password);

  if (direction === 'stop') {
    await stopMove(host, port, username, password, profileToken);
    return;
  }

  const vel = directionToVelocity(direction, speed);

  const soapBody = [
    '<tptz:ContinuousMove>',
    `  <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
    '  <tptz:Velocity>',
    `    <tt:PanTilt x="${vel.panX}" y="${vel.tiltY}"/>`,
    `    <tt:Zoom x="${vel.zoomZ}"/>`,
    '  </tptz:Velocity>',
    '</tptz:ContinuousMove>',
  ].join('\n');

  await ptzSoapRequest(host, port, soapBody, username, password);

  // Auto-stop after duration for smooth control
  setTimeout(() => {
    stopMove(host, port, username, password, profileToken).catch((err) => {
      console.error('[PTZ] Auto-stop error:', err.message);
    });
  }, durationMs);
}

/**
 * Stop all PTZ movement on the camera.
 */
async function stopMove(
  host: string,
  port: number,
  username: string,
  password: string,
  profileToken: string
): Promise<void> {
  const soapBody = [
    '<tptz:Stop>',
    `  <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
    '  <tptz:PanTilt>true</tptz:PanTilt>',
    '  <tptz:Zoom>true</tptz:Zoom>',
    '</tptz:Stop>',
  ].join('\n');

  await ptzSoapRequest(host, port, soapBody, username, password);
}

/**
 * List all PTZ presets configured on the camera.
 */
export async function getPresets(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<PtzPreset[]> {
  const profileToken = await resolvePtzProfileToken(host, port, username, password);

  const soapBody = [
    '<tptz:GetPresets>',
    `  <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
    '</tptz:GetPresets>',
  ].join('\n');

  const xml = await ptzSoapRequest(host, port, soapBody, username, password);

  const presetBlocks = extractAllBlocks(xml, 'Preset');
  return presetBlocks.map((block) => ({
    token: extractAttribute(block, 'token'),
    name: extractTag(block, 'Name'),
  }));
}

/**
 * Move the camera to a previously saved preset position.
 */
export async function gotoPreset(
  host: string,
  port: number,
  username: string,
  password: string,
  presetToken: string
): Promise<void> {
  const profileToken = await resolvePtzProfileToken(host, port, username, password);

  const soapBody = [
    '<tptz:GotoPreset>',
    `  <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>`,
    `  <tptz:PresetToken>${presetToken}</tptz:PresetToken>`,
    '  <tptz:Speed>',
    '    <tt:PanTilt x="0.5" y="0.5"/>',
    '    <tt:Zoom x="0.5"/>',
    '  </tptz:Speed>',
    '</tptz:GotoPreset>',
  ].join('\n');

  await ptzSoapRequest(host, port, soapBody, username, password);
}
