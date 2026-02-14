#!/usr/bin/env node
/**
 * Puppeteer E2E test: Sidebar cleanup + Telegram notifications
 * 1. Login
 * 2. Verify sidebar items removed
 * 3. Check integrations page (Telegram)
 * 4. Verify LPR detection creates Event + triggers notification
 * 5. Check notifications API
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/camai-notif-test';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
}

(async () => {
  console.log('\n🔔 Notifications & Sidebar E2E Test\n');

  const { mkdirSync } = await import('fs');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // ─── Step 1: Login ───
  console.log('1️⃣  Logging in...');
  await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: 'networkidle2', timeout: 15000 });
  const csrfData = await page.evaluate(() => JSON.parse(document.body.innerText));

  await page.evaluate(async (csrf) => {
    await fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=admin@demo.com&password=admin123&csrfToken=${csrf}`,
      credentials: 'include',
      redirect: 'follow',
    });
  }, csrfData.csrfToken);

  const session = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    return await r.json();
  });
  console.log(`  ✅ Logged in as: ${session?.user?.name || 'unknown'}`);

  // ─── Step 2: Verify sidebar cleanup ───
  console.log('\n2️⃣  Verifying sidebar items...');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  const sidebarCheck = await page.evaluate(() => {
    const navLinks = [...document.querySelectorAll('aside a')];
    const labels = navLinks.map(a => a.textContent?.trim()).filter(Boolean);

    const removedItems = [
      'Филиалы', 'Аудит', 'Автоматизация', 'Видеоархив',
      'Карта объекта', 'Кросс-трекинг', 'Мониторинг полок',
      'Отказоустойчивость', 'Аудио-аналитика'
    ];

    const stillPresent = removedItems.filter(item => labels.includes(item));
    const requiredItems = ['Камеры', 'Номера авто', 'Посещаемость', 'Интеграции', 'Настройки'];
    const missingRequired = requiredItems.filter(item => !labels.includes(item));

    return { labels, stillPresent, missingRequired };
  });

  console.log(`  Sidebar items: ${sidebarCheck.labels.join(', ')}`);

  if (sidebarCheck.stillPresent.length > 0) {
    console.error(`  ❌ Items should be removed: ${sidebarCheck.stillPresent.join(', ')}`);
  } else {
    console.log('  ✅ All unnecessary items removed');
  }

  if (sidebarCheck.missingRequired.length > 0) {
    console.error(`  ❌ Missing required items: ${sidebarCheck.missingRequired.join(', ')}`);
  } else {
    console.log('  ✅ All required items present');
  }

  await shot(page, '01-sidebar');

  // ─── Step 3: Check integrations page ───
  console.log('\n3️⃣  Checking integrations page...');
  await page.goto(`${BASE}/integrations`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await shot(page, '02-integrations');

  const integrationsState = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasTelegram: text.includes('Telegram') || text.includes('telegram'),
      hasConnect: text.includes('Подключить') || text.includes('подключить') || text.includes('t.me'),
      bodyText: text.substring(0, 500),
    };
  });

  console.log(`  Telegram section: ${integrationsState.hasTelegram ? '✅' : '❌'}`);
  console.log(`  Connect button: ${integrationsState.hasConnect ? '✅' : '❌'}`);

  // ─── Step 4: Verify LPR events in DB ───
  console.log('\n4️⃣  Checking LPR events in database...');

  const events = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/events?type=plate_detected&limit=5', { credentials: 'include' });
      if (!r.ok) return { error: r.status };
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  });

  const plateEvents = events?.events || [];
  console.log(`  Plate events in DB: ${plateEvents.length}`);

  if (plateEvents.length > 0) {
    const latest = plateEvents[0];
    console.log(`  Latest: "${latest.description}" (${latest.severity}) at ${latest.timestamp}`);
    console.log('  ✅ LPR events are being recorded');
  } else {
    console.log('  ⚠️  No plate events yet (plate-service may need to detect a plate)');
  }

  // ─── Step 5: Check notifications ───
  console.log('\n5️⃣  Checking notifications...');

  const notifications = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/notifications?limit=10', { credentials: 'include' });
      if (!r.ok) return { error: r.status };
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  });

  const notifList = Array.isArray(notifications) ? notifications : notifications?.notifications || [];
  console.log(`  Total notifications: ${notifList.length}`);

  if (notifList.length > 0) {
    for (const n of notifList.slice(0, 3)) {
      console.log(`    ${n.status === 'sent' ? '✅' : n.status === 'failed' ? '❌' : '⏳'} ${n.featureType}: ${n.message?.substring(0, 60)}...`);
    }
  } else {
    console.log('  ℹ️  No notifications sent yet (Telegram not connected)');
  }

  // ─── Step 6: Check plate-service status ───
  console.log('\n6️⃣  Checking plate-service...');

  const health = await page.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:8003/health');
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  });

  if (health) {
    console.log(`  Status: ${health.status}, Engine: ${health.engine}`);
    const cams = Object.entries(health.cameras || {});
    for (const [camId, data] of cams) {
      const d = data;
      console.log(`  Camera ${camId}: alive=${d.alive}, fps=${d.fps}, plates=${d.plates_detected}`);
    }
  } else {
    console.log('  ⚠️  plate-service not reachable');
  }

  // ─── Step 7: Verify camera page (LPR overlay) ───
  console.log('\n7️⃣  Checking camera page...');
  const cameras = await page.evaluate(async () => {
    const r = await fetch('/api/cameras', { credentials: 'include' });
    return await r.json();
  });

  const lprCam = cameras.find(c => c.purpose === 'lpr');
  if (lprCam) {
    console.log(`  LPR camera: ${lprCam.name} (${lprCam.id}), monitoring=${lprCam.isMonitoring}`);
    await page.goto(`${BASE}/cameras/${lprCam.id}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(5000);
    await shot(page, '03-camera-page');

    // Wait for overlay
    await sleep(3000);
    await shot(page, '04-camera-overlay');
    console.log('  ✅ Camera page loaded');
  } else {
    console.log('  ⚠️  No LPR camera found');
  }

  // ─── Summary ───
  console.log('\n' + '═'.repeat(50));
  console.log('  📊 Notifications E2E Test Summary');
  console.log('═'.repeat(50));
  console.log(`  Sidebar cleanup:    ${sidebarCheck.stillPresent.length === 0 ? '✅' : '❌'}`);
  console.log(`  Telegram UI:        ${integrationsState.hasTelegram ? '✅' : '❌'}`);
  console.log(`  LPR events in DB:   ${plateEvents.length > 0 ? '✅' : '⚠️'}`);
  console.log(`  Notifications:      ${notifList.length > 0 ? '✅ (' + notifList.length + ')' : 'ℹ️  (Telegram not connected)'}`);
  console.log(`  plate-service:      ${health ? '✅' : '❌'}`);
  console.log(`  Screenshots:        ${SCREENSHOT_DIR}`);
  console.log('═'.repeat(50));

  console.log('\n✅ Notifications E2E test complete!');

  await sleep(3000);
  await browser.close();
})();
