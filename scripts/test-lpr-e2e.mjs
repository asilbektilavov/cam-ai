#!/usr/bin/env node
/**
 * Puppeteer E2E test: Full LPR flow
 * 1. Login
 * 2. Open cameras page
 * 3. Auto-discover cameras
 * 4. Select purpose = LPR
 * 5. Quick Add discovered camera
 * 6. Start monitoring
 * 7. Open camera page, wait for plate detections
 * 8. Check LPR journal
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/camai-lpr-e2e';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const p = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
}

(async () => {
  console.log('\n🚗 LPR E2E Test — Full Flow\n');

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

  // ─── Step 2: Open cameras page ───
  console.log('\n2️⃣  Opening cameras page...');
  await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);
  await shot(page, '01-cameras-page');

  // ─── Step 3: Click "Поиск камер" (Search cameras) ───
  console.log('\n3️⃣  Clicking "Поиск камер"...');
  const scanBtn = await page.evaluateHandle(() => {
    const buttons = [...document.querySelectorAll('button')];
    return buttons.find(b => b.textContent.includes('Поиск камер'));
  });

  if (!scanBtn || !(await scanBtn.asElement())) {
    console.error('  ❌ "Поиск камер" button not found!');
    await shot(page, '03-error-no-scan-btn');
    await browser.close();
    process.exit(1);
  }

  await scanBtn.asElement().click();
  console.log('  Scanning network...');

  // Wait for scan to complete (scanning spinner disappears, results appear)
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Найдено:') || text.includes('Камеры не найдены');
  }, { timeout: 30000 });

  await sleep(1000);
  await shot(page, '02-scan-results');

  // Check if cameras found
  const scanResult = await page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes('Камеры не найдены')) return { found: 0 };
    const match = text.match(/Найдено:\s*(\d+)/);
    return { found: match ? parseInt(match[1]) : 0 };
  });

  console.log(`  Found ${scanResult.found} camera(s)`);

  if (scanResult.found === 0) {
    console.error('  ❌ No cameras discovered!');
    await browser.close();
    process.exit(1);
  }

  // ─── Step 4: Select purpose = LPR ───
  console.log('\n4️⃣  Selecting purpose = LPR...');

  // Click the purpose selector trigger
  const purposeSelector = await page.evaluateHandle(() => {
    // Find the label "Назначение:" then the select next to it
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => l.textContent.includes('Назначение'));
    if (label) {
      const trigger = label.parentElement?.querySelector('button[role="combobox"]');
      return trigger || null;
    }
    // Fallback: find any combobox in the scan dialog that shows "Обнаружение объектов"
    const buttons = [...document.querySelectorAll('button[role="combobox"]')];
    return buttons.find(b => b.textContent.includes('Обнаружение'));
  });

  if (purposeSelector && await purposeSelector.asElement()) {
    await purposeSelector.asElement().click();
    await sleep(500);

    // Click the LPR option
    const lprOption = await page.evaluateHandle(() => {
      const options = [...document.querySelectorAll('[role="option"]')];
      return options.find(o => o.textContent.includes('Распознавание номеров') || o.textContent.includes('LPR'));
    });

    if (lprOption && await lprOption.asElement()) {
      await lprOption.asElement().click();
      await sleep(500);
      console.log('  ✅ Purpose set to LPR');
    } else {
      console.warn('  ⚠️  Could not find LPR option, will use default purpose');
    }
  } else {
    console.warn('  ⚠️  Purpose selector not found in scan dialog');
  }

  await shot(page, '03-purpose-selected');

  // ─── Step 5: Quick Add first discovered camera ───
  console.log('\n5️⃣  Quick adding first camera...');

  const addBtn = await page.evaluateHandle(() => {
    const buttons = [...document.querySelectorAll('button')];
    // Find "Добавить" button that is NOT the main dialog trigger
    return buttons.find(b => {
      const text = b.textContent.trim();
      return text === 'Добавить' && b.closest('[role="dialog"]');
    });
  });

  if (!addBtn || !(await addBtn.asElement())) {
    console.error('  ❌ Quick Add button not found!');
    await shot(page, '05-error-no-add-btn');
    await browser.close();
    process.exit(1);
  }

  await addBtn.asElement().click();
  console.log('  Adding camera...');
  await sleep(3000);
  await shot(page, '04-camera-added');

  // Verify camera was added
  const addResult = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasAdded: text.includes('Добавлена') || text.includes('добавлена'),
    };
  });
  console.log(`  Camera added: ${addResult.hasAdded ? '✅' : '❌'}`);

  // Close scan dialog
  await page.keyboard.press('Escape');
  await sleep(1000);

  // ─── Step 6: Verify camera purpose via API ───
  console.log('\n6️⃣  Verifying camera purpose...');
  const cameras = await page.evaluate(async () => {
    const r = await fetch('/api/cameras', { credentials: 'include' });
    return await r.json();
  });

  const lprCamera = cameras.find(c => c.purpose === 'lpr');
  const anyCamera = cameras[0];

  if (lprCamera) {
    console.log(`  ✅ Camera "${lprCamera.name}" has purpose=lpr, id=${lprCamera.id}`);
  } else if (anyCamera) {
    console.log(`  ⚠️  Camera "${anyCamera.name}" has purpose=${anyCamera.purpose} (expected lpr)`);
    console.log('  Using it anyway for testing...');
  } else {
    console.error('  ❌ No cameras found in API!');
    await browser.close();
    process.exit(1);
  }

  const testCamera = lprCamera || anyCamera;

  // ─── Step 7: Start monitoring ───
  console.log('\n7️⃣  Starting monitoring...');
  await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);

  // Find and click the monitor toggle via API
  const monitorResult = await page.evaluate(async (camId) => {
    try {
      const r = await fetch(`/api/cameras/${camId}/monitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      const data = await r.json();
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, testCamera.id);

  console.log(`  Monitor result: ${monitorResult.ok ? '✅ Started' : '❌ Failed'}`);
  if (!monitorResult.ok) {
    console.log(`  Error: ${JSON.stringify(monitorResult.data || monitorResult.error)}`);
  }

  await sleep(3000);
  await shot(page, '05-monitoring-started');

  // ─── Step 8: Open camera page ───
  console.log(`\n8️⃣  Opening camera page: /cameras/${testCamera.id}`);
  await page.goto(`${BASE}/cameras/${testCamera.id}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(5000);
  await shot(page, '06-camera-page');

  // Check page state
  const pageState = await page.evaluate(() => {
    return {
      title: document.title,
      hasVideo: !!document.querySelector('video, video-rtc, canvas'),
      bodyText: document.body.innerText.substring(0, 800),
    };
  });
  console.log(`  Page title: ${pageState.title}`);
  console.log(`  Has video/canvas: ${pageState.hasVideo}`);

  // ─── Step 9: Wait for plate detections ───
  console.log('\n9️⃣  Waiting for plate detections...');
  console.log('    Polling plate-events API every 2s for 60s...\n');

  let detected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);

    // Check plate-events
    const events = await page.evaluate(async (camId) => {
      try {
        const r = await fetch(`/api/lpr/plate-events?cameraId=${camId}`, { credentials: 'include' });
        if (!r.ok) return { error: r.status };
        return await r.json();
      } catch (e) {
        return { error: e.message };
      }
    }, testCamera.id);

    // Check plate-service health
    const health = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8003/health');
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    });

    const serverPlates = Array.isArray(events?.detections) ? events.detections : [];
    const camHealth = health?.cameras?.[testCamera.id];
    const fps = camHealth?.fps || 0;
    const totalPlates = camHealth?.plates_detected || 0;

    if (i % 3 === 0 || serverPlates.length > 0) {
      console.log(`  ⏳ ${(i+1)*2}s | Overlay plates: ${serverPlates.length} | Service fps: ${fps} | Total: ${totalPlates} | alive: ${camHealth?.alive ?? '?'}`);
    }

    if (serverPlates.length > 0) {
      console.log('\n  🎉 PLATE DETECTED IN OVERLAY!');
      for (const p of serverPlates) {
        console.log(`    📋 Number: ${p.label || 'N/A'} | Confidence: ${((p.confidence || 0) * 100).toFixed(1)}% | Color: ${p.color || 'N/A'}`);
      }
      detected = true;
      await shot(page, '07-plate-detected');
      break;
    }

    if (totalPlates > 0 && !detected) {
      console.log(`\n  🎉 plate-service detected ${totalPlates} plate(s)!`);
      detected = true;
      await shot(page, '07-plate-detected-service');
    }
  }

  if (!detected) {
    console.log('\n  ⚠️  No plates detected in 60 seconds.');

    const health = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8003/health');
        return await r.json();
      } catch { return null; }
    });

    if (health) {
      console.log(`  plate-service status: ${health.status}`);
      console.log(`  Cameras: ${JSON.stringify(health.cameras)}`);
    } else {
      console.log('  ❌ plate-service is not reachable');
    }
  }

  await shot(page, '08-final-camera');

  // ─── Step 10: Check LPR journal ───
  console.log('\n🔟  Checking LPR journal...');
  await page.goto(`${BASE}/lpr`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await shot(page, '09-lpr-journal');

  const journalState = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr, [class*="detection"]');
    return {
      detectionCount: rows.length,
      pageText: document.body.innerText.substring(0, 400),
    };
  });
  console.log(`  Journal entries: ${journalState.detectionCount}`);

  // ─── Summary ───
  console.log('\n' + '═'.repeat(50));
  console.log('  📊 E2E Test Summary');
  console.log('═'.repeat(50));
  console.log(`  Camera found:     ✅`);
  console.log(`  Purpose = LPR:    ${lprCamera ? '✅' : '⚠️  (used ' + testCamera.purpose + ')'}`);
  console.log(`  Monitor started:  ${monitorResult.ok ? '✅' : '❌'}`);
  console.log(`  Plates detected:  ${detected ? '✅' : '❌'}`);
  console.log(`  Screenshots:      ${SCREENSHOT_DIR}`);
  console.log('═'.repeat(50));

  console.log('\n✅ LPR E2E test complete!');

  await sleep(3000);
  await browser.close();
})();
