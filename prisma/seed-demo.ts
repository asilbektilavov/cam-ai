import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// ============= HELPERS =============

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedRandomHour(): number {
  const w = [1,1,0,0,0,0,1,2, 5,8,12,15,18,16,14,12, 10,9,8,7,5,3,2,1];
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) {
    r -= w[h];
    if (r <= 0) return h;
  }
  return 12;
}

function generateTimestamp(daysBack: number): Date {
  const now = new Date();
  const ago = Math.random() * daysBack;
  const d = new Date(now.getTime() - ago * 24 * 60 * 60 * 1000);
  d.setHours(weightedRandomHour(), rand(0, 59), rand(0, 59), rand(0, 999));
  return d;
}

function generateRecentTimestamp(hoursBack: number): Date {
  const now = new Date();
  const ago = Math.random() * hoursBack;
  return new Date(now.getTime() - ago * 60 * 60 * 1000);
}

// Minimal valid JPEG (1x1 pixel, grey)
function placeholderJpeg(): Buffer {
  return Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
    0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3F, 0x00, 0x7B, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9,
  ]);
}

// ============= DATA CONSTANTS =============

const DEMO_EMAIL = 'admin@demo.com';
const DEMO_PASSWORD = 'admin123';
const ORG_NAME = 'Сеть магазинов "Ромашка"';

const BRANCHES = [
  { name: 'Алмазар',  address: 'г. Ташкент, ул. Алмазарская, 15' },
  { name: 'Чиланзар', address: 'г. Ташкент, ул. Бунёдкор, 42' },
  { name: 'Юнусабад', address: 'г. Ташкент, пр. Амира Темура, 88' },
];

const CAMERAS = [
  { name: 'Вход главный', location: 'Входная зона, 1 этаж',     branch: 0, status: 'online',  monitoring: true,  url: 'rtsp://demo:demo@192.168.1.101:554/stream' },
  { name: 'Касса 1-2',    location: 'Кассовая зона',            branch: 0, status: 'online',  monitoring: true,  url: 'rtsp://demo:demo@192.168.1.102:554/stream' },
  { name: 'Торговый зал',  location: 'Основной зал, центр',      branch: 1, status: 'online',  monitoring: true,  url: 'rtsp://demo:demo@192.168.1.103:554/stream' },
  { name: 'Склад',         location: 'Складское помещение',       branch: 1, status: 'offline', monitoring: false, url: 'rtsp://demo:demo@192.168.1.104:554/stream' },
  { name: 'Парковка',      location: 'Парковка перед магазином',  branch: 2, status: 'online',  monitoring: false, url: 'rtsp://demo:demo@192.168.1.105:554/stream' },
];

const EVENT_TYPES = [
  { type: 'motion_detected',     severity: 'info',     weight: 40 },
  { type: 'people_count',        severity: 'info',     weight: 25 },
  { type: 'face_detected',       severity: 'info',     weight: 10 },
  { type: 'queue_detected',      severity: 'warning',  weight: 10 },
  { type: 'suspicious_behavior', severity: 'warning',  weight: 8 },
  { type: 'alert',               severity: 'critical', weight: 7 },
];

const DESCRIPTIONS: Record<string, string[]> = {
  motion_detected: [
    'Обнаружено движение в зоне входа',
    'Активность у витрины с электроникой',
    'Движение в кассовой зоне',
    'Обнаружена активность у стеллажей',
    'Движение в проходе между секциями',
    'Зафиксировано перемещение у выхода',
  ],
  people_count: [
    'В торговом зале 12 человек',
    'На входе 3 человека',
    'В кассовой зоне 5 человек',
    'У витрины 2 человека',
    'В зоне самообслуживания 4 человека',
    'Подсчёт: 8 посетителей в секции продуктов',
  ],
  face_detected: [
    'Распознано лицо у входа',
    'Новый посетитель зафиксирован',
    'Зафиксирован повторный визит клиента',
    'Лицо распознано в кассовой зоне',
  ],
  queue_detected: [
    'Очередь на кассе 1: 6 человек, ожидание ~4 мин',
    'Очередь на кассе 2: 8 человек, ожидание ~6 мин',
    'Длинная очередь обнаружена у кассы',
    'Превышено время ожидания в очереди (>5 мин)',
    'Очередь: 7 человек, рекомендуется открыть доп. кассу',
  ],
  suspicious_behavior: [
    'Подозрительное поведение: человек длительно стоит у витрины',
    'Обнаружено нетипичное перемещение у стеллажей',
    'Нетипичная активность в зоне хранения',
    'Человек без покупок провёл >15 мин в одной зоне',
    'Подозрительное поведение у кассы самообслуживания',
  ],
  alert: [
    'Несанкционированный доступ в зону склада',
    'Обнаружена попытка выноса товара без оплаты',
    'Срабатывание в ночное время: движение на складе',
    'Камера зафиксировала проникновение в закрытую зону',
    'Критическое: неизвестный в зоне ограниченного доступа',
  ],
};

const PERSON_NAMES = [
  { name: 'Иванов Сергей',   active: true,  sightings: 5 },
  { name: 'Петрова Анна',    active: true,  sightings: 3 },
  { name: 'Каримов Алишер',  active: false, sightings: 2 },
];

const SIGHTING_DESCS = [
  'Обнаружен у главного входа',
  'Замечен в кассовой зоне',
  'Зафиксирован у витрины',
  'Обнаружен на парковке',
  'Замечен в торговом зале',
];

// ============= EVENT TYPE PICKER =============

function pickEventType(): { type: string; severity: string } {
  const total = EVENT_TYPES.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const et of EVENT_TYPES) {
    r -= et.weight;
    if (r <= 0) return { type: et.type, severity: et.severity };
  }
  return EVENT_TYPES[0];
}

// ============= MAIN =============

async function main() {
  console.log('=== CamAI Demo Seed ===\n');

  // 1. Clear all data
  console.log('[1/10] Clearing database...');
  await prisma.personSighting.deleteMany();
  await prisma.searchPerson.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.smartFeature.deleteMany();
  await prisma.analysisFrame.deleteMany();
  await prisma.analysisSession.deleteMany();
  await prisma.event.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.remoteEvent.deleteMany();
  await prisma.remoteCamera.deleteMany();
  await prisma.remoteInstance.deleteMany();
  await prisma.syncQueue.deleteMany();
  await prisma.organization.deleteMany();

  // 2. Organization
  console.log('[2/10] Creating organization...');
  const org = await prisma.organization.create({
    data: { name: ORG_NAME, slug: 'romashka-demo' },
  });

  // 3. User + Settings
  console.log('[3/10] Creating user...');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Администратор',
      passwordHash,
      role: 'admin',
      organizationId: org.id,
    },
  });

  await prisma.userSettings.create({
    data: {
      userId: user.id,
      notifCritical: true,
      notifWarnings: true,
      notifInfo: true,
      notifSystem: true,
      notifDailyReport: true,
      notifWeeklyReport: true,
      language: 'ru',
      timezone: 'utc+5',
      autoRecord: true,
      cloudStorage: true,
      aiQuality: 'high',
    },
  });

  // 4. Branches
  console.log('[4/10] Creating branches...');
  const branchRecords = [];
  for (const b of BRANCHES) {
    const branch = await prisma.branch.create({
      data: { name: b.name, address: b.address, organizationId: org.id },
    });
    branchRecords.push(branch);
  }

  // 5. Cameras
  console.log('[5/10] Creating cameras...');
  const cameraRecords = [];
  for (const c of CAMERAS) {
    const cam = await prisma.camera.create({
      data: {
        name: c.name,
        location: c.location,
        streamUrl: c.url,
        status: c.status,
        venueType: 'retail',
        resolution: '1920x1080',
        fps: 30,
        isMonitoring: c.monitoring,
        motionThreshold: 5.0,
        captureInterval: 5,
        organizationId: org.id,
        branchId: branchRecords[c.branch].id,
      },
    });
    cameraRecords.push(cam);
  }

  const onlineCameras = cameraRecords.filter((_, i) => CAMERAS[i].status === 'online');

  // 6. Events (~450 over 7 days)
  console.log('[6/10] Generating events (450+)...');
  const events = [];
  for (let i = 0; i < 460; i++) {
    const { type, severity } = pickEventType();
    const cam = pick(onlineCameras);
    const camIdx = cameraRecords.indexOf(cam);
    events.push({
      cameraId: cam.id,
      organizationId: org.id,
      branchId: branchRecords[CAMERAS[camIdx].branch].id,
      type,
      severity,
      description: pick(DESCRIPTIONS[type]),
      timestamp: generateTimestamp(7),
      metadata: JSON.stringify({ peopleCount: rand(0, 12), confidence: randFloat(0.7, 0.99) }),
    });
  }

  // Add ~30 events for today (more recent)
  for (let i = 0; i < 30; i++) {
    const { type, severity } = pickEventType();
    const cam = pick(onlineCameras);
    const camIdx = cameraRecords.indexOf(cam);
    events.push({
      cameraId: cam.id,
      organizationId: org.id,
      branchId: branchRecords[CAMERAS[camIdx].branch].id,
      type,
      severity,
      description: pick(DESCRIPTIONS[type]),
      timestamp: generateRecentTimestamp(12),
      metadata: JSON.stringify({ peopleCount: rand(0, 12), confidence: randFloat(0.7, 0.99) }),
    });
  }

  await prisma.event.createMany({ data: events });
  console.log(`  Created ${events.length} events`);

  // 7. Analysis Sessions + Frames
  console.log('[7/10] Creating analysis sessions and frames...');
  let totalFrames = 0;

  for (let s = 0; s < 28; s++) {
    const cam = pick(onlineCameras);
    const startedAt = generateTimestamp(7);
    const durationMin = rand(5, 30);
    const endedAt = new Date(startedAt.getTime() + durationMin * 60 * 1000);

    const session = await prisma.analysisSession.create({
      data: {
        cameraId: cam.id,
        startedAt,
        endedAt,
        status: 'completed',
        triggerType: pick(['motion', 'scheduled', 'manual']),
        summary: `Анализ завершён: обнаружено ${rand(1, 8)} человек, ${rand(0, 3)} инцидента`,
      },
    });

    const frameCount = rand(3, 10);
    const frames = [];
    for (let f = 0; f < frameCount; f++) {
      const fTime = new Date(startedAt.getTime() + (durationMin / frameCount) * f * 60 * 1000);
      frames.push({
        sessionId: session.id,
        framePath: `data/frames/demo/session_${s}_frame_${f}.jpg`,
        capturedAt: fTime,
        aiResponse: JSON.stringify({ scene: 'retail_' + pick(['entrance', 'checkout', 'aisle', 'shelf']), objects: ['person', 'bag', 'cart'] }),
        description: `Обнаружено ${rand(1, 8)} человек в кадре`,
        peopleCount: rand(1, 8),
        objects: JSON.stringify(['person', 'bag', 'shelf', 'cart'].slice(0, rand(1, 4))),
      });
    }
    await prisma.analysisFrame.createMany({ data: frames });
    totalFrames += frameCount;
  }
  console.log(`  Created 28 sessions, ${totalFrames} frames`);

  // 8. Integration (Telegram)
  console.log('[8/10] Creating integrations...');
  const telegramIntegration = await prisma.integration.create({
    data: {
      organizationId: org.id,
      type: 'telegram',
      name: 'Telegram',
      enabled: true,
      config: JSON.stringify({ botToken: 'demo-bot-token', chatId: 'demo-chat-id' }),
    },
  });

  // Smart Features
  await prisma.smartFeature.create({
    data: { cameraId: cameraRecords[0].id, featureType: 'queue_monitor', enabled: true, config: JSON.stringify({ threshold: 5, alertAfterSeconds: 120 }) },
  });
  await prisma.smartFeature.create({
    data: { cameraId: cameraRecords[0].id, featureType: 'person_search', enabled: true, config: '{}' },
  });
  await prisma.smartFeature.create({
    data: { cameraId: cameraRecords[2].id, featureType: 'loitering_detection', enabled: true, config: JSON.stringify({ zoneSeconds: 300 }) },
  });

  // Notifications
  const notifMessages = [
    'Очередь на кассе 1 превысила 5 человек',
    'Обнаружено подозрительное поведение у витрины',
    'Критическое: проникновение на склад',
    'Счётчик посетителей: 156 за сегодня',
    'Камера "Склад" перешла в офлайн',
  ];
  for (const msg of notifMessages) {
    await prisma.notification.create({
      data: {
        organizationId: org.id,
        integrationId: telegramIntegration.id,
        featureType: 'queue_monitor',
        cameraId: pick(onlineCameras).id,
        message: msg,
        status: 'sent',
        sentAt: generateTimestamp(3),
      },
    });
  }

  // 9. Person Search + Sightings
  console.log('[9/10] Creating search persons and sightings...');

  // Create placeholder photos directory
  const photoDir = join(process.cwd(), 'data', 'search-photos', org.id);
  try { mkdirSync(photoDir, { recursive: true }); } catch {}
  const jpeg = placeholderJpeg();

  for (const p of PERSON_NAMES) {
    const photoFilename = `demo_${p.name.replace(/\s/g, '_')}.jpg`;
    const photoPath = join('data', 'search-photos', org.id, photoFilename);

    // Write placeholder photo
    try { writeFileSync(join(process.cwd(), photoPath), jpeg); } catch {}

    const descriptor = Array.from({ length: 128 }, () => randFloat(-1, 1));

    const person = await prisma.searchPerson.create({
      data: {
        organizationId: org.id,
        name: p.name,
        photoPath,
        faceDescriptor: JSON.stringify(descriptor),
        isActive: p.active,
      },
    });

    // Sightings
    const sightings = [];
    for (let i = 0; i < p.sightings; i++) {
      sightings.push({
        searchPersonId: person.id,
        cameraId: pick(onlineCameras).id,
        timestamp: generateTimestamp(7),
        description: pick(SIGHTING_DESCS),
        confidence: randFloat(0.72, 0.96),
        notified: Math.random() > 0.5,
      });
    }
    await prisma.personSighting.createMany({ data: sightings });
  }

  // 10. Remote instances (for multi-branch demo on central page)
  console.log('[10/10] Creating remote instances...');
  await prisma.remoteInstance.create({
    data: {
      organizationId: org.id,
      instanceId: 'satellite-chilandar-001',
      name: 'Ромашка Чиланзар',
      branchName: 'Чиланзар',
      address: 'г. Ташкент, ул. Бунёдкор, 42',
      status: 'online',
      lastSyncAt: new Date(Date.now() - 3 * 60 * 1000), // 3 min ago
    },
  });
  await prisma.remoteInstance.create({
    data: {
      organizationId: org.id,
      instanceId: 'satellite-yunusabad-002',
      name: 'Ромашка Юнусабад',
      branchName: 'Юнусабад',
      address: 'г. Ташкент, пр. Амира Темура, 88',
      status: 'online',
      lastSyncAt: new Date(Date.now() - 7 * 60 * 1000), // 7 min ago
    },
  });

  console.log('\n=== Demo Seed Complete! ===');
  console.log(`Organization: ${ORG_NAME}`);
  console.log(`Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Branches: ${BRANCHES.length}`);
  console.log(`Cameras: ${CAMERAS.length}`);
  console.log(`Events: ${events.length}`);
  console.log(`Sessions: 28, Frames: ${totalFrames}`);
  console.log(`Search Persons: ${PERSON_NAMES.length}`);
  console.log('========================\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
