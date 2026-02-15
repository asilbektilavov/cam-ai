#!/usr/bin/env node
/**
 * Auto-Zoom E2E Test
 * Full user path: Login → Cameras → Add attendance camera with ONVIF →
 *   Start monitoring → View camera page → Verify face detection + auto-zoom
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/camai-autozoom-e2e';
const ATTENDANCE_SERVICE = 'http://localhost:8002';

// Camera config
const CAMERA = {
  name: 'Входная камера (AutoZoom)',
  streamUrl: 'rtsp://admin:12072000xO@192.168.1.55/live/0/MAIN',
  purpose: 'attendance_entry',
  onvifHost: '192.168.1.55',
  onvifPort: 80,
  onvifUser: 'admin',
  onvifPass: '12072000xO',
};

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
  console.log('\n🏁 AUTO-ZOOM E2E TEST\n');

  const { mkdirSync } = await import('fs');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  try {
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
    check('Logged in as ' + (session?.user?.name || 'UNKNOWN'), !!session?.user?.name);

    // ─── Step 2: Ensure branch exists ───
    console.log('\n2️⃣  Ensure branch exists...');
    const branches = await page.evaluate(async () => {
      const r = await fetch('/api/branches', { credentials: 'include' });
      return await r.json();
    });

    let branchId;
    if (Array.isArray(branches) && branches.length > 0) {
      branchId = branches[0].id;
      console.log(`  Branch exists: ${branches[0].name} (${branchId})`);
    } else {
      const newBranch = await page.evaluate(async () => {
        const r = await fetch('/api/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Главный офис' }),
          credentials: 'include',
        });
        return await r.json();
      });
      branchId = newBranch.id;
      console.log(`  Created branch: Главный офис (${branchId})`);
    }
    check('Branch available', !!branchId);

    // ─── Step 3: Navigate to cameras page ───
    console.log('\n3️⃣  Navigate to cameras page...');
    await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    await shot(page, '01-cameras-page');

    // ─── Step 4: Check for existing attendance camera or create one ───
    console.log('\n4️⃣  Add attendance camera with ONVIF...');

    // Check existing cameras via API
    const existingCameras = await page.evaluate(async () => {
      const r = await fetch('/api/cameras', { credentials: 'include' });
      return await r.json();
    });

    let cameraId;
    const existing = Array.isArray(existingCameras)
      ? existingCameras.find(c => c.purpose === 'attendance_entry' || c.purpose === 'attendance_exit')
      : null;

    if (existing) {
      cameraId = existing.id;
      console.log(`  Using existing camera: ${existing.name} (${cameraId})`);
    } else {
      // Create camera via API
      const createResp = await page.evaluate(async (cam, bid) => {
        const r = await fetch('/api/cameras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cam.name,
            location: 'Главный вход',
            streamUrl: cam.streamUrl,
            purpose: cam.purpose,
            branchId: bid,
            venueType: 'office',
            onvifHost: cam.onvifHost,
            onvifPort: cam.onvifPort,
            onvifUser: cam.onvifUser,
            onvifPass: cam.onvifPass,
            hasPtz: true,
          }),
          credentials: 'include',
        });
        return { status: r.status, body: await r.json() };
      }, CAMERA, branchId);

      console.log(`  Create response: ${createResp.status}`, JSON.stringify(createResp.body).substring(0, 200));
      cameraId = createResp.body.id;
      console.log(`  Created camera: ${CAMERA.name} (${cameraId})`);
    }
    check('Camera available', !!cameraId);

    // Reload cameras page to see the new camera
    await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    await shot(page, '02-cameras-with-new');

    // ─── Step 5: Start monitoring ───
    console.log('\n5️⃣  Start monitoring...');

    // First stop the test-autozoom camera on attendance-service to free resources
    try {
      await fetch(`${ATTENDANCE_SERVICE}/cameras/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'camera_id=test-autozoom',
      });
      console.log('  Stopped test-autozoom camera');
    } catch { /* ok */ }

    const monitorResp = await page.evaluate(async (camId) => {
      const r = await fetch(`/api/cameras/${camId}/monitor`, {
        method: 'POST',
        credentials: 'include',
      });
      return { status: r.status, body: await r.json() };
    }, cameraId);

    console.log(`  Monitor response: ${monitorResp.status}`, JSON.stringify(monitorResp.body));
    check('Monitoring started', monitorResp.status === 200 && monitorResp.body.success);

    await sleep(3000);
    await shot(page, '03-monitoring-started');

    // ─── Step 6: Check attendance-service health ───
    console.log('\n6️⃣  Check attendance-service health...');
    await sleep(5000); // Wait for camera to start in attendance-service

    const healthResp = await fetch(`${ATTENDANCE_SERVICE}/health`);
    const health = await healthResp.json();
    console.log('  Health:', JSON.stringify(health, null, 2));

    const cameraHealth = health.cameras?.[cameraId];
    check('Camera registered in attendance-service', !!cameraHealth);
    check('Auto-zoom enabled', cameraHealth?.auto_zoom === true);
    check('Camera is alive', cameraHealth?.alive === true);

    // ─── Step 7: Navigate to camera view page ───
    console.log('\n7️⃣  View camera page...');
    await page.goto(`${BASE}/cameras/${cameraId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(8000); // Wait for video player + detection overlay to load
    await shot(page, '04-camera-view');

    // Check for video player
    const hasVideoPlayer = await page.evaluate(() => {
      return !!(
        document.querySelector('video-rtc') ||
        document.querySelector('video') ||
        document.querySelector('img[alt*="camera"]') ||
        document.querySelector('[class*="player"]')
      );
    });
    check('Video player rendered', hasVideoPlayer);

    // Check for detection overlay canvas
    const hasOverlay = await page.evaluate(() => {
      return !!document.querySelector('canvas');
    });
    check('Detection overlay canvas present', hasOverlay);

    // ─── Step 8: Wait for face detections ───
    console.log('\n8️⃣  Wait for face detections...');
    let facesDetected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(2000);

      // Check attendance-service for face detections
      const h = await (await fetch(`${ATTENDANCE_SERVICE}/health`)).json();
      const cam = h.cameras?.[cameraId];
      if (cam?.faces_detected > 0) {
        console.log(`  Faces detected: ${cam.faces_detected}, FPS: ${cam.fps}`);
        facesDetected = true;
        break;
      }
      console.log(`  Waiting... (attempt ${i + 1}/20)`);
    }
    check('Face detection working', facesDetected);

    await shot(page, '05-face-detection');

    // Check face events polling in browser
    const faceEvents = await page.evaluate(async (camId) => {
      const r = await fetch(`/api/attendance/face-events?cameraId=${camId}`, { credentials: 'include' });
      return await r.json();
    }, cameraId);
    console.log(`  Face events from API: ${JSON.stringify(faceEvents).substring(0, 200)}`);
    check('Face events API responding', faceEvents && (Array.isArray(faceEvents) || Array.isArray(faceEvents.detections)));

    // ─── Step 9: Check auto-zoom status ───
    console.log('\n9️⃣  Check auto-zoom activity...');
    const healthFinal = await (await fetch(`${ATTENDANCE_SERVICE}/health`)).json();
    const camFinal = healthFinal.cameras?.[cameraId];
    console.log(`  Final health: faces=${camFinal?.faces_detected}, fps=${camFinal?.fps}, auto_zoom=${camFinal?.auto_zoom}`);
    check('Auto-zoom still enabled', camFinal?.auto_zoom === true);

    // Take a final screenshot with all overlays visible
    await sleep(3000);
    await shot(page, '06-final-with-overlays');

    // ─── Step 10: Check attendance page ───
    console.log('\n🔟  Check attendance page...');
    await page.goto(`${BASE}/attendance`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    await shot(page, '07-attendance-page');

    const attendancePageOk = await page.evaluate(() => {
      return document.body.innerText.length > 100;
    });
    check('Attendance page loads', attendancePageOk);

    // ─── Summary ───
    console.log('\n' + '═'.repeat(50));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    console.log(`📁 Screenshots: ${SCREENSHOT_DIR}/`);
    console.log('═'.repeat(50));

    if (failed > 0) {
      console.log('\n⚠️  Some checks failed. Review screenshots for details.');
    } else {
      console.log('\n🎉 All checks passed! Auto-zoom is working.');
    }

  } catch (err) {
    console.error('\n💥 Fatal error:', err.message);
    await shot(page, 'error-state').catch(() => {});
  }

  // Don't close browser so user can see the result
  console.log('\n🔍 Browser left open for inspection. Close manually when done.');
  // await browser.close();
})();
