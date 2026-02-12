/**
 * Автоматическое отключение встроенной AI-детекции IP-камеры.
 * Поддерживает проприетарный XML API (китайские IPC: ElectronicFence, PeopleDetect и т.д.)
 * Best-effort: если камера не поддерживает API — логируем и молча пропускаем.
 */

const TIMEOUT_MS = 5000;
const TAG = '[AI-Disabler]';

interface CameraCredentials {
  hostname: string;
  username: string;
  password: string;
}

function parseRtspUrl(streamUrl: string): CameraCredentials | null {
  try {
    // rtsp://admin:admin@192.168.1.55:554/stream1
    const url = new URL(streamUrl);
    const hostname = url.hostname;
    const username = decodeURIComponent(url.username || 'admin');
    const password = decodeURIComponent(url.password || '');
    return { hostname, username, password };
  } catch {
    return null;
  }
}

function makeAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function tryFetchXml(
  baseUrl: string,
  path: string,
  auth: string,
  method: 'GET' | 'PUT' = 'GET',
  body?: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/xml',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * GET конфиг → заменить Enable/true на false → PUT обратно
 */
async function disableXmlFeature(
  baseUrl: string,
  auth: string,
  path: string,
  replacements: Array<[RegExp, string]>
): Promise<boolean> {
  const xml = await tryFetchXml(baseUrl, path, auth, 'GET');
  if (!xml) return false;

  let modified = xml;
  for (const [pattern, replacement] of replacements) {
    modified = modified.replace(pattern, replacement);
  }

  // Ничего не изменилось — уже отключено
  if (modified === xml) {
    console.log(`${TAG} ${path} — already disabled`);
    return true;
  }

  const result = await tryFetchXml(baseUrl, path, auth, 'PUT', modified);
  if (result !== null) {
    console.log(`${TAG} ${path} — disabled`);
    return true;
  }
  return false;
}

/**
 * Попытка отключить встроенную AI-детекцию камеры.
 * Пробует несколько auth-комбинаций: credentials из RTSP URL + пустой пароль (веб-API).
 */
export async function disableCameraBuiltinAI(streamUrl: string): Promise<void> {
  const creds = parseRtspUrl(streamUrl);
  if (!creds) {
    console.log(`${TAG} Cannot parse RTSP URL, skipping`);
    return;
  }

  const { hostname, username, password } = creds;
  const baseUrl = `http://${hostname}`;

  // Пробуем оба варианта auth: из RTSP URL и пустой пароль (веб-API)
  const authVariants = [
    makeAuthHeader(username, ''),        // веб-API (пустой пароль)
    makeAuthHeader(username, password),   // credentials из RTSP URL
  ];

  let auth: string | null = null;

  // Определяем работающий auth
  for (const candidate of authVariants) {
    const probe = await tryFetchXml(baseUrl, '/System/deviceInfo', candidate, 'GET');
    if (probe) {
      auth = candidate;
      break;
    }
  }

  if (!auth) {
    console.log(`${TAG} Camera ${hostname} does not support proprietary API, skipping`);
    return;
  }

  console.log(`${TAG} Disabling built-in AI for ${hostname}...`);

  let anySuccess = false;

  // 1. ElectronicFence (электронный забор)
  const r1 = await disableXmlFeature(baseUrl, auth, '/System/ElectronicDenceUIDesignCfg', [
    [/<Enable>true<\/Enable>/gi, '<Enable>false</Enable>'],
    [/<TriggerEnable>true<\/TriggerEnable>/gi, '<TriggerEnable>false</TriggerEnable>'],
    [/<AlarmOutEnable>true<\/AlarmOutEnable>/gi, '<AlarmOutEnable>false</AlarmOutEnable>'],
    [/<BuzzerEnable>true<\/BuzzerEnable>/gi, '<BuzzerEnable>false</BuzzerEnable>'],
  ]);
  if (r1) anySuccess = true;

  // 2. CrossBorder detection (пересечение границ)
  const r2 = await disableXmlFeature(baseUrl, auth, '/System/CrossBorderDetectUIDesignInfo', [
    [/<Enable>true<\/Enable>/gi, '<Enable>false</Enable>'],
  ]);
  if (r2) anySuccess = true;

  // 3. OffDuty detection (дежурство)
  const r3 = await disableXmlFeature(baseUrl, auth, '/System/OffDutyDetectUIDesignCfg', [
    [/<Enable>true<\/Enable>/gi, '<Enable>false</Enable>'],
  ]);
  if (r3) anySuccess = true;

  // 4. PolygonConfig (PeopleDetect / CarDetect)
  const r4 = await disableXmlFeature(baseUrl, auth, '/Alarm/1/PolygonConfig', [
    [/<UseForPeopleDetect>true<\/UseForPeopleDetect>/gi, '<UseForPeopleDetect>false</UseForPeopleDetect>'],
    [/<UseForCarDetect>true<\/UseForCarDetect>/gi, '<UseForCarDetect>false</UseForCarDetect>'],
  ]);
  if (r4) anySuccess = true;

  if (anySuccess) {
    console.log(`${TAG} Disabled built-in AI for ${hostname}`);
  } else {
    console.log(`${TAG} No AI features found to disable on ${hostname}`);
  }
}
