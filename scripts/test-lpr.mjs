#!/usr/bin/env node
/**
 * Puppeteer test: LPR (License Plate Recognition) live monitoring
 * Opens camera page and monitors for plate detections
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const CAMERA_ID = 'cmlm86rvg0001jghorz9s0lji';
const SCREENSHOT_DIR = '/tmp/camai-lpr-test';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${path}`);
}

(async () => {
  console.log('\n🚗 LPR Detection Test\n');

  const { mkdirSync } = await import('fs');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // ─── Login via NextAuth API ───
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

  // ─── Open camera page ───
  console.log(`\n2️⃣  Opening camera page: /cameras/${CAMERA_ID}`);
  await page.goto(`${BASE}/cameras/${CAMERA_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  await shot(page, '01-camera-page');

  // Check page state
  const pageState = await page.evaluate(() => {
    return {
      title: document.title,
      hasVideo: !!document.querySelector('video, video-rtc, img[alt*="camera"], img[alt*="Camera"]'),
      hasCanvas: !!document.querySelector('canvas'),
      bodyText: document.body.innerText.substring(0, 500),
    };
  });
  console.log(`  Page title: ${pageState.title}`);
  console.log(`  Has video: ${pageState.hasVideo}, Has canvas: ${pageState.hasCanvas}`);

  // ─── Monitor for plate detections ───
  console.log('\n3️⃣  Monitoring for plate detections...');
  console.log('    🔴 Hold a photo with a license plate in front of the camera NOW!');
  console.log('    Polling every 2 seconds for 60 seconds...\n');

  let detected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);

    // Check server-side plate events via API
    const events = await page.evaluate(async (camId) => {
      try {
        const r = await fetch(`/api/lpr/plate-events?cameraId=${camId}`, { credentials: 'include' });
        if (!r.ok) return { error: r.status };
        return await r.json();
      } catch (e) {
        return { error: e.message };
      }
    }, CAMERA_ID);

    // Check plate-service health
    const plateHealth = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8003/health');
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    });

    // Check browser-side detections (from page state)
    const pageDetections = await page.evaluate(() => {
      // Look for any plate detection text on the page
      const text = document.body.innerText;
      const plateMatch = text.match(/[A-ZА-Я]\d{3}[A-ZА-Я]{2}\d{2,3}/g);

      // Check for detection overlay elements
      const overlays = document.querySelectorAll('canvas');

      return {
        plateTextMatches: plateMatch || [],
        canvasCount: overlays.length,
        hasDetectionUI: text.includes('Обнаружен') || text.includes('номер'),
      };
    });

    const serverPlates = Array.isArray(events?.detections) ? events.detections : [];
    const fps = plateHealth?.cameras?.[CAMERA_ID]?.fps || 0;
    const totalPlates = plateHealth?.cameras?.[CAMERA_ID]?.plates_detected || 0;

    if (i % 3 === 0 || serverPlates.length > 0) {
      console.log(`  ⏳ ${(i+1)*2}s | Server plates: ${serverPlates.length} | Service fps: ${fps} | Total detected: ${totalPlates} | Canvas: ${pageDetections.canvasCount}`);
    }

    if (serverPlates.length > 0) {
      console.log('\n  🎉 PLATE DETECTED!');
      for (const p of serverPlates) {
        console.log(`    📋 Number: ${p.label || 'N/A'} | Confidence: ${((p.confidence || 0) * 100).toFixed(1)}% | Color: ${p.color || 'N/A'}`);
      }
      detected = true;
      await shot(page, '02-plate-detected');
      break;
    }

    if (totalPlates > 0 && !detected) {
      console.log(`\n  🎉 plate-service detected ${totalPlates} plate(s)!`);
      detected = true;
      await shot(page, '02-plate-detected-service');
    }
  }

  if (!detected) {
    console.log('\n  ⚠️  No plates detected in 60 seconds.');
    console.log('  Possible reasons:');
    console.log('    - Camera stream not accessible (wrong credentials?)');
    console.log('    - Photo not visible to camera');
    console.log('    - Plate text too small or blurry');

    // Final diagnostic
    const health = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8003/health');
        return await r.json();
      } catch { return null; }
    });

    if (health) {
      const cam = health.cameras?.[CAMERA_ID];
      if (cam) {
        console.log(`\n  Diagnostics: alive=${cam.alive}, fps=${cam.fps}, plates=${cam.plates_detected}`);
        if (cam.fps === 0) {
          console.log('  ❌ FPS=0 means plate-service cannot read frames from this camera');
          console.log('     Check stream URL and credentials');
        }
      }
    }
  }

  // ─── Take final screenshot ───
  await shot(page, '03-final');

  // ─── Check LPR journal ───
  console.log('\n4️⃣  Checking LPR journal...');
  await page.goto(`${BASE}/lpr`, { waitUntil: 'networkidle2', timeout: 15000 });
  await sleep(2000);
  await shot(page, '04-lpr-journal');

  const journalState = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr, [class*="detection"]');
    return {
      detectionCount: rows.length,
      pageText: document.body.innerText.substring(0, 300),
    };
  });
  console.log(`  Journal detections: ${journalState.detectionCount}`);

  console.log('\n✅ LPR test complete! Screenshots:', SCREENSHOT_DIR);

  await sleep(3000);
  await browser.close();
})();
