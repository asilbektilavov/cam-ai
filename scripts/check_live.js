const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // 1. Login
  console.log('=== Logging in ===');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 15000 });

  const emailInput = await page.$('input[type="email"], input[name="email"]');
  const passInput = await page.$('input[type="password"], input[name="password"]');
  if (emailInput && passInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type('admin@demo.com');
    await passInput.click({ clickCount: 3 });
    await passInput.type('admin123');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await new Promise(r => setTimeout(r, 4000));
  }
  console.log('After login URL:', page.url());

  // 2. Navigate to camera page (use domcontentloaded — video streams never fully "idle")
  console.log('=== Opening camera page ===');
  await page.goto('http://localhost:3000/cameras/cmlnnphld02ppjghoicsgnltn', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });
  await new Promise(r => setTimeout(r, 6000)); // wait for React hydration + video
  await page.screenshot({ path: '/tmp/live_1_camera.png' });
  console.log('Camera page URL:', page.url());

  // Check page content
  const pageTitle = await page.evaluate(() => {
    const h1 = document.querySelector('h1, h2, h3');
    return h1?.textContent || document.title;
  });
  console.log('Page title/heading:', pageTitle);

  // Check if canvas overlay exists
  const canvasInfo = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    return canvases.map(c => ({
      w: c.width, h: c.height, id: c.id,
      style: c.style.cssText?.substring(0, 100),
    }));
  });
  console.log('Canvas elements:', JSON.stringify(canvasInfo));

  // 3. Take screenshots over time
  for (let i = 2; i <= 8; i++) {
    console.log(`\n--- Waiting 5s (screenshot ${i}) ---`);
    await new Promise(r => setTimeout(r, 5000));
    await page.screenshot({ path: `/tmp/live_${i}_camera.png` });

    // Face events
    const faceData = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/attendance/face-events?cameraId=cmlnnphld02ppjghoicsgnltn');
        return await r.json();
      } catch (e) { return { error: e.message }; }
    });
    const dets = faceData.detections || [];
    console.log(`  Faces: ${dets.length}${dets.length > 0 ? ' → ' + dets.map(d => d.label).join(', ') : ''}`);

    // Zoom state
    const zoom = await page.evaluate(async () => {
      try {
        const r = await fetch('http://localhost:8002/health');
        const d = await r.json();
        const cam = d.cameras?.cmlnnphld02ppjghoicsgnltn;
        return cam ? `${cam.hw_zoom_state} (fps=${cam.fps})` : 'no camera data';
      } catch (e) { return e.message; }
    });
    console.log(`  Zoom: ${zoom}`);
  }

  await browser.close();
  console.log('\nDone.');
})();
