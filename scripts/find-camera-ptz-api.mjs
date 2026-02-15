/**
 * Puppeteer script to explore camera web UI and find PTZ/zoom API.
 * Intercepts all network requests to find CGI/API calls when zoom is used.
 */
import puppeteer from 'puppeteer';
import fs from 'fs';

const CAMERA_URL = 'http://192.168.1.55';
const USERNAME = 'admin';
const PASSWORD = '12072000xO';
const SCREENSHOT_DIR = '/tmp/camai-camera-explore';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: false, // Show browser so user can see
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 },
  });

  const page = await browser.newPage();

  // Collect ALL network requests
  const allRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('favicon') && !url.includes('.css') && !url.includes('.png') && !url.includes('.jpg') && !url.includes('.gif')) {
      allRequests.push({
        method: req.method(),
        url: url,
        postData: req.postData() || null,
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('ptz') || url.includes('PTZ') || url.includes('zoom') || url.includes('motor') ||
        url.includes('Zoom') || url.includes('cgi') || url.includes('CGI') ||
        url.includes('Mix') || url.includes('mix') || url.includes('Set') || url.includes('Get')) {
      try {
        const body = await res.text();
        console.log(`\n=== INTERESTING RESPONSE: ${res.status()} ${url} ===`);
        console.log(body.substring(0, 500));
      } catch {}
    }
  });

  // Step 1: Login
  console.log('Step 1: Navigating to camera...');
  await page.goto(CAMERA_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-login.png` });

  // Fill login form
  console.log('Step 2: Logging in...');
  await page.waitForSelector('#username', { timeout: 5000 });
  await page.evaluate(() => { document.getElementById('username').value = ''; });
  await page.type('#username', USERNAME);
  await page.type('#passwd', PASSWORD);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-login-filled.png` });

  // Submit login
  await page.click('#userform button[type="submit"], #userform input[type="submit"], #loginBtn');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-after-login.png` });

  console.log('Step 3: Current URL:', page.url());

  // Step 3: Navigate to all settings pages and look for PTZ
  const pagesToCheck = [
    '#ipc/pages/preview/video.html',
    '#ipc/pages/netWork/ipAddress.html',
    '#ipc/pages/audioAndvideo/video.html',
  ];

  for (const hash of pagesToCheck) {
    console.log(`\nNavigating to ${hash}...`);
    await page.goto(`${CAMERA_URL}/index.html${hash}`, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    const safeName = hash.replace(/[#/]/g, '_');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/page_${safeName}.png` });
  }

  // Step 4: Find all navigation links
  console.log('\n=== Step 4: Finding all nav links ===');
  const navLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && href !== '#' && href.includes('.html')) {
        links.push({ href, text });
      }
    });
    // Also check sidebar
    document.querySelectorAll('#left-panel a, .nav a, .sidebar a, nav a').forEach(a => {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && href !== '#') {
        links.push({ href, text });
      }
    });
    return links;
  });

  console.log('Found links:');
  const uniqueLinks = [...new Set(navLinks.map(l => l.href))];
  for (const link of uniqueLinks) {
    const text = navLinks.find(l => l.href === link)?.text || '';
    console.log(`  ${link} — ${text}`);
  }

  // Step 5: Visit each page and screenshot
  console.log('\n=== Step 5: Visiting all pages ===');
  for (const link of uniqueLinks) {
    if (link.includes('.html') && !link.includes('logout')) {
      const fullUrl = link.startsWith('http') ? link : `${CAMERA_URL}/index.html#${link}`;
      console.log(`Visiting: ${fullUrl}`);
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));
        const safeName = link.replace(/[#/.]/g, '_').substring(0, 50);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/visit_${safeName}.png` });

        // Check page content for PTZ keywords
        const content = await page.content();
        if (/ptz|zoom|motor|lens|focus|pan|tilt/i.test(content)) {
          console.log(`  *** FOUND PTZ KEYWORDS on ${link} ***`);
          await page.screenshot({ path: `${SCREENSHOT_DIR}/PTZ_${safeName}.png` });

          // Get all JS loaded on this page
          const scripts = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
          });
          console.log('  Scripts:', scripts.filter(s => !s.includes('jquery') && !s.includes('bootstrap')));
        }
      } catch (e) {
        console.log(`  Error: ${e.message}`);
      }
    }
  }

  // Step 6: Dump all captured API requests
  console.log('\n=== Step 6: All captured requests ===');
  const apiRequests = allRequests.filter(r =>
    !r.url.includes('.js') && !r.url.includes('.html') && !r.url.includes('.css') &&
    !r.url.includes('.png') && !r.url.includes('.jpg') && !r.url.includes('favicon')
  );
  for (const req of apiRequests) {
    console.log(`${req.method} ${req.url}`);
    if (req.postData) console.log(`  POST: ${req.postData.substring(0, 200)}`);
  }

  // Step 7: Try direct API calls
  console.log('\n=== Step 7: Testing API endpoints ===');
  const testUrls = [
    '/cgi-bin/ptz.cgi?action=getStatus',
    '/cgi-bin/configManager.cgi?action=getConfig&name=Ptz',
    '/API/PTZControl',
    '/ISAPI/PTZCtrl/channels/1/status',
    '/System/configManager?action=getConfig&name=Ptz',
    '/api/v1/ptz',
    '/onvif/ptz_service',
    '/mixinGet?url=/PTZ/1/GetPTZCtrl',
    '/mixinGet?url=/PTZ/GetPTZCtrl',
    '/PTZ/1/GetPTZCtrl',
    '/PTZCtrl',
    '/param.cgi?cmd=getptzctrl',
  ];

  for (const testUrl of testUrls) {
    try {
      const resp = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { credentials: 'include' });
          const text = await r.text();
          return { status: r.status, body: text.substring(0, 300) };
        } catch (e) {
          return { status: -1, body: e.message };
        }
      }, testUrl);
      if (resp.status !== 404 && resp.status !== -1) {
        console.log(`${resp.status} ${testUrl}: ${resp.body}`);
      }
    } catch {}
  }

  // Keep browser open for 10s for user to inspect
  console.log('\n=== Done! Screenshots in', SCREENSHOT_DIR, '===');
  console.log('Keeping browser open for 30s...');
  await new Promise(r => setTimeout(r, 30000));
  await browser.close();
}

main().catch(console.error);
