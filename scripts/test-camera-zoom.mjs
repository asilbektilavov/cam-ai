/**
 * Test camera PTZ zoom using Puppeteer's built-in HTTP auth.
 */
import puppeteer from 'puppeteer';

const CAMERA_URL = 'http://192.168.1.55';
const USERNAME = 'admin';
const PASSWORD = '12072000xO';

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox'],
    defaultViewport: { width: 1200, height: 800 },
  });

  const page = await browser.newPage();

  // Puppeteer's built-in HTTP Basic Auth — responds to 401 challenges automatically
  await page.authenticate({ username: USERNAME, password: PASSWORD });

  // Navigate to camera
  console.log('Step 1: Navigating with HTTP auth...');
  await page.goto(`${CAMERA_URL}/index.html#preview.html`, {
    waitUntil: 'networkidle2',
    timeout: 20000,
  }).catch(() => {});

  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: '/tmp/cam-zoom-01.png' });
  console.log('URL:', page.url());

  // Check page state
  const state = await page.evaluate(() => ({
    title: document.title,
    hash: location.hash,
    hasConfig: typeof config !== 'undefined',
    user: typeof config !== 'undefined' ? config.user : null,
    hasPTZ: typeof PTZControl === 'function',
    hasJQuery: typeof $ !== 'undefined',
  }));
  console.log('State:', JSON.stringify(state));

  // If config.user is empty, set it manually then call Login
  if (state.hasConfig && !state.user) {
    console.log('\nSetting config credentials and calling Login...');
    await page.evaluate((u, p) => {
      config.user = u;
      config.password = p;
      if (typeof Login === 'function') Login();
    }, USERNAME, PASSWORD);
    await new Promise(r => setTimeout(r, 3000));

    // Navigate to preview to load PTZControl
    await page.goto(`${CAMERA_URL}/index.html#preview.html`, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
  }

  // Re-check state
  const state2 = await page.evaluate(() => ({
    user: typeof config !== 'undefined' ? config.user : null,
    hasPTZ: typeof PTZControl === 'function',
    hash: location.hash,
  }));
  console.log('State after login:', JSON.stringify(state2));
  await page.screenshot({ path: '/tmp/cam-zoom-02.png' });

  if (state2.hasPTZ) {
    console.log('\n*** PTZControl found! ***');

    // ZoomIn
    console.log('ZoomIn (speed=5) for 3s...');
    await page.evaluate(() => PTZControl(1, 'ZoomIn', 5));
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() => PTZControl(0, 'ZoomIn', 0));
    console.log('ZoomIn done.');
    await page.screenshot({ path: '/tmp/cam-zoom-03-in.png' });

    // ZoomOut
    await new Promise(r => setTimeout(r, 1000));
    console.log('ZoomOut (speed=5) for 5s...');
    await page.evaluate(() => PTZControl(1, 'ZoomOut', 5));
    await new Promise(r => setTimeout(r, 5000));
    await page.evaluate(() => PTZControl(0, 'ZoomOut', 0));
    console.log('ZoomOut done.');
    await page.screenshot({ path: '/tmp/cam-zoom-04-out.png' });

    // Test all PTZ
    console.log('\nAll PTZ endpoints:');
    for (const ep of ['TurnUp','TurnDown','TurnLeft','TurnRight','ZoomIn','ZoomOut','FocusIn','FocusOut']) {
      try {
        await page.evaluate((e) => PTZControl(1, e, 1), ep);
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate((e) => PTZControl(0, e, 0), ep);
        console.log(`  ${ep}: OK`);
      } catch (e) {
        console.log(`  ${ep}: ERROR`);
      }
    }
  } else {
    console.log('\nPTZControl still not found. Trying direct XHR with credentials...');

    // Use XMLHttpRequest with withCredentials (not fetch)
    const zoomResult = await page.evaluate((user, pass) => {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', '/PTZ/1/ZoomIn', true, user, pass);
        xhr.setRequestHeader('If-Modified-Since', '0');
        xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText.substring(0, 200) });
        xhr.onerror = () => resolve({ error: 'network error' });
        xhr.timeout = 5000;
        xhr.ontimeout = () => resolve({ error: 'timeout' });
        xhr.send('Param1=1&Param2=3');
      });
    }, USERNAME, PASSWORD);
    console.log('XHR ZoomIn:', JSON.stringify(zoomResult));

    if (zoomResult.status === 200) {
      console.log('*** ZOOM WORKS via XHR! ***');
      await new Promise(r => setTimeout(r, 3000));
      await page.evaluate((user, pass) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', '/PTZ/1/ZoomIn', true, user, pass);
        xhr.setRequestHeader('If-Modified-Since', '0');
        xhr.send('Param1=0&Param2=0');
      }, USERNAME, PASSWORD);
    }
  }

  console.log('\nDone! Screenshots in /tmp/cam-zoom-*');
  await new Promise(r => setTimeout(r, 15000));
  await browser.close();
}

main().catch(console.error);
