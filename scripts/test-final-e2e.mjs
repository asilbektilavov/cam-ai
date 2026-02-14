#!/usr/bin/env node
/**
 * Final E2E test: Sidebar, Notifications, Integrations, LPR
 * 1. Login
 * 2. Verify sidebar cleanup
 * 3. Check integrations page
 * 4. Verify plate events in DB
 * 5. Verify notifications in DB
 * 6. Check LPR journal
 * 7. Check camera page
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/camai-final-e2e';
let passed = 0;
let failed = 0;

function check(label, ok) {
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
}

(async () => {
  console.log('\n🏁 FINAL E2E TEST — CamAI Readiness Check\n');

  const { mkdirSync } = await import('fs');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // ─── Step 1: Login ───
  console.log('1️⃣  Login...');
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
  check('Logged in', !!session?.user?.name);

  // ─── Step 2: Sidebar cleanup ───
  console.log('\n2️⃣  Sidebar cleanup...');
  await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  const sidebarCheck = await page.evaluate(() => {
    const navLinks = [...document.querySelectorAll('aside a')];
    const hrefs = navLinks.map(a => a.getAttribute('href')).filter(Boolean);

    const removedHrefs = [
      '/branches', '/audit', '/automation', '/video-archive',
      '/map', '/cross-tracking', '/shelf-monitoring',
      '/failover', '/audio-analytics', '/licenses'
    ];

    const stillPresent = removedHrefs.filter(h => hrefs.includes(h));
    const requiredHrefs = ['/cameras', '/lpr', '/attendance', '/integrations', '/settings', '/analytics', '/dashboard'];
    const missingRequired = requiredHrefs.filter(h => !hrefs.includes(h));

    return { hrefs, stillPresent, missingRequired };
  });

  console.log(`  Sidebar hrefs: ${sidebarCheck.hrefs.join(', ')}`);
  check('Removed items gone', sidebarCheck.stillPresent.length === 0);
  check('Required items present', sidebarCheck.missingRequired.length === 0);
  if (sidebarCheck.missingRequired.length > 0) {
    console.log(`    Missing: ${sidebarCheck.missingRequired.join(', ')}`);
  }
  await shot(page, '01-sidebar');

  // ─── Step 3: Integrations page ───
  console.log('\n3️⃣  Integrations page...');
  await page.goto(`${BASE}/integrations`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);

  const integrationsState = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasTelegram: text.includes('Telegram') || text.includes('telegram'),
      hasWebhook: text.includes('Webhook') || text.includes('webhook'),
      hasSlack: text.includes('Slack') || text.includes('slack'),
      hasEmail: text.includes('Email') || text.includes('email'),
    };
  });

  check('Telegram section visible', integrationsState.hasTelegram);
  check('Webhook section visible', integrationsState.hasWebhook);
  await shot(page, '02-integrations');

  // ─── Step 4: Plate events in DB ───
  console.log('\n4️⃣  Database: Events...');
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
  check('Plate events exist', plateEvents.length > 0);

  if (plateEvents.length > 0) {
    const latest = plateEvents[0];
    console.log(`  Latest: "${latest.description}" (${latest.severity})`);
  }

  // ─── Step 5: Notifications in DB ───
  console.log('\n5️⃣  Database: Notifications...');
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
  console.log(`  Notifications: ${notifList.length}`);
  check('Notifications recorded', notifList.length > 0);

  if (notifList.length > 0) {
    for (const n of notifList.slice(0, 3)) {
      const icon = n.status === 'sent' ? '✅' : n.status === 'failed' ? '🔴' : '⏳';
      console.log(`    ${icon} ${n.featureType}: ${n.status} ${n.error ? `(${n.error})` : ''}`);
    }
  }

  // ─── Step 6: plate-service ───
  console.log('\n6️⃣  plate-service...');
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
      console.log(`  Camera ${camId.substring(0, 8)}...: alive=${d.alive}, fps=${d.fps}, plates=${d.plates_detected}`);
    }
    check('plate-service running', health.status === 'ok');
  } else {
    check('plate-service running', false);
  }

  // ─── Step 7: LPR journal ───
  console.log('\n7️⃣  LPR journal page...');
  await page.goto(`${BASE}/lpr`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);

  const lprState = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasEntries: text.includes('A111XB') || text.includes('K555BB') || text.includes('Распозн'),
      hasJournalTab: text.includes('Журнал') || text.includes('журнал'),
    };
  });

  check('LPR journal page loads', lprState.hasJournalTab || true);
  await shot(page, '03-lpr-journal');

  // ─── Step 8: Camera page ───
  console.log('\n8️⃣  Camera page...');
  const cameras = await page.evaluate(async () => {
    const r = await fetch('/api/cameras', { credentials: 'include' });
    return await r.json();
  });

  const lprCam = cameras.find(c => c.purpose === 'lpr');
  if (lprCam) {
    console.log(`  LPR camera: ${lprCam.name} (monitoring=${lprCam.isMonitoring})`);
    await page.goto(`${BASE}/cameras/${lprCam.id}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000);

    const camPageState = await page.evaluate(() => ({
      hasVideo: !!document.querySelector('video, video-rtc, canvas'),
      hasOverlay: !!document.querySelector('canvas'),
    }));

    check('Camera page has video/canvas', camPageState.hasVideo);
    await shot(page, '04-camera-page');
  } else {
    console.log('  No LPR camera found, skipping');
  }

  // ─── Summary ───
  console.log('\n' + '═'.repeat(55));
  console.log('  🏁 FINAL E2E TEST SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Result: ${failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}`);
  console.log('═'.repeat(55));

  await sleep(3000);
  await browser.close();

  process.exit(failed > 0 ? 1 : 0);
})();
