const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Login to CamAI
  console.log('=== Opening camera page ===');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 15000 });

  // Login
  await page.type('input[name="email"], input[type="email"]', 'admin@camai.local');
  await page.type('input[name="password"], input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await new Promise(r => setTimeout(r, 3000));

  // Navigate to camera page
  await page.goto('http://localhost:3000/cameras/cmlnnphld02ppjghoicsgnltn', {
    waitUntil: 'networkidle2', timeout: 15000
  });
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: '/tmp/cam_page_1.png', fullPage: false });
  console.log('Screenshot 1: initial page load');

  // Wait and take more screenshots to see zoom behavior
  console.log('Waiting 10s to observe zoom behavior...');
  await new Promise(r => setTimeout(r, 10000));
  await page.screenshot({ path: '/tmp/cam_page_2.png', fullPage: false });
  console.log('Screenshot 2: after 10s');

  // Check the face detections state in browser
  const faceState = await page.evaluate(() => {
    // Look for detection overlay canvas
    const canvases = document.querySelectorAll('canvas');
    const overlayInfo = [];
    canvases.forEach(c => {
      overlayInfo.push({
        width: c.width,
        height: c.height,
        id: c.id,
        class: c.className,
      });
    });
    return { canvasCount: canvases.length, canvases: overlayInfo };
  });
  console.log('Canvas elements:', JSON.stringify(faceState));

  // Check attendance service health
  const health = await page.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:8002/health');
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('Attendance service health:', JSON.stringify(health));

  // Check face-events polling response
  const faceEvents = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/attendance/face-events?cameraId=cmlnnphld02ppjghoicsgnltn');
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('Face events:', JSON.stringify(faceEvents));

  // Wait more and check zoom state
  console.log('Waiting 15s more...');
  await new Promise(r => setTimeout(r, 15000));
  await page.screenshot({ path: '/tmp/cam_page_3.png', fullPage: false });
  console.log('Screenshot 3: after 25s total');

  // Check face events again
  const faceEvents2 = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/attendance/face-events?cameraId=cmlnnphld02ppjghoicsgnltn');
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('Face events (2nd check):', JSON.stringify(faceEvents2));

  // Check auto-zoom state
  const zoomState = await page.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:8002/health');
      const d = await r.json();
      return d.cameras || d;
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('Zoom state:', JSON.stringify(zoomState));

  await browser.close();
  console.log('\nDone. Screenshots at /tmp/cam_page_1.png, _2.png, _3.png');
})();
