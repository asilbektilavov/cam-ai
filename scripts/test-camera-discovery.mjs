#!/usr/bin/env node
/**
 * Puppeteer test: Camera auto-discovery flow
 * Tests: login → scan network → view results → quick add camera
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = '/tmp/camai-test-screenshots';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function shot(page, name) {
  const path = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 Screenshot: ${path}`);
}

(async () => {
  console.log('\n🚀 Starting Camera Discovery Test\n');

  const { mkdirSync } = await import('fs');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  // ─── Step 1: Login via NextAuth API (direct POST, not React signIn) ───
  console.log('1️⃣  Logging in via NextAuth API...');

  // First, get CSRF token
  await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: 'networkidle2', timeout: 15000 });
  const csrfData = await page.evaluate(() => JSON.parse(document.body.innerText));
  console.log(`  CSRF token: ${csrfData.csrfToken?.substring(0, 20)}...`);

  // POST to credentials callback — browser handles Set-Cookie natively
  await page.goto(`${BASE}/api/auth/callback/credentials`, { waitUntil: 'networkidle2', timeout: 15000 });
  // Actually, we need to POST. Let's use page.evaluate with fetch:
  const loginResult = await page.evaluate(async (csrf) => {
    const res = await fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=admin@demo.com&password=admin123&csrfToken=${csrf}`,
      credentials: 'include',
      redirect: 'follow',
    });
    return { status: res.status, url: res.url, ok: res.ok };
  }, csrfData.csrfToken);
  console.log(`  Login response:`, loginResult);

  // Check session
  const session1 = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    return await r.json();
  });
  console.log(`  Session after API login:`, JSON.stringify(session1)?.substring(0, 100));

  if (!session1?.user) {
    // Fallback: POST via form submission (native browser redirect handles cookies)
    console.log('  ⚠️  API fetch didn\'t set cookie. Trying form POST...');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(500);

    // Build a hidden form and submit it natively (browser handles Set-Cookie on redirect)
    await page.evaluate((csrf) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/auth/callback/credentials';
      ['email:admin@demo.com', 'password:admin123', `csrfToken:${csrf}`].forEach(pair => {
        const [name, value] = pair.split(':');
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }, csrfData.csrfToken);

    await sleep(5000);
    console.log(`  URL after form POST: ${page.url()}`);
    await shot(page, '01-after-form-login');

    const session2 = await page.evaluate(async () => {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      return await r.json();
    });
    console.log(`  Session after form login:`, JSON.stringify(session2)?.substring(0, 100));
  }

  console.log(`  ✅ Current URL: ${page.url()}`);

  // Debug: check cookies
  const cookies = await page.cookies();
  console.log('  🍪 Cookies:', cookies.map(c => `${c.name}=${c.value.substring(0,20)}...`).join(', '));

  // ─── Step 2: Navigate to cameras page & select branch ───
  console.log('\n2️⃣  Navigating to cameras page...');
  await page.goto(`${BASE}/cameras`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(2000);

  // Select branch via header dropdown
  console.log('  Selecting branch from header...');
  await sleep(1000);

  // Click the branch Select trigger in the header (contains "Филиал" placeholder)
  const triggerClicked = await page.evaluate(() => {
    const triggers = document.querySelectorAll('button[role="combobox"]');
    for (const t of triggers) {
      if (t.textContent?.includes('Филиал') || t.closest('header')) {
        t.click();
        return t.textContent?.trim();
      }
    }
    return null;
  });
  console.log('  Trigger clicked:', triggerClicked);
  await sleep(500);

  // Select the first option
  const optionPicked = await page.evaluate(() => {
    const options = document.querySelectorAll('[role="option"]');
    if (options.length > 0) {
      const text = options[0].textContent?.trim();
      options[0].click();
      return text;
    }
    return null;
  });
  console.log('  Selected branch:', optionPicked);
  await sleep(1000);

  await shot(page, '02-cameras-page');
  console.log(`  ✅ URL: ${page.url()}`);

  // ─── Intercept network for debug ───
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/cameras') || url.includes('/api/auth/session')) {
      console.log(`  🌐 ${res.status()} ${res.request().method()} ${url.replace(BASE, '')}`);
    }
  });

  // Check session first
  console.log('\n  Checking session...');
  const sessionResp = await page.evaluate(async () => {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    return { status: r.status, body: await r.json() };
  });
  console.log(`  Session: ${JSON.stringify(sessionResp)}`);

  // ─── Step 3: Click "Поиск камер" button ───
  console.log('\n3️⃣  Looking for "Поиск камер" button...');

  const searchBtn = await page.evaluateHandle(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.includes('Поиск камер')) return btn;
    }
    return null;
  });

  if (!searchBtn || (await searchBtn.jsonValue()) === null) {
    console.log('  ❌ "Поиск камер" button not found!');
    const buttonTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
    });
    console.log('  Available buttons:', buttonTexts);
    await shot(page, '03-no-search-button');
    await browser.close();
    return;
  }

  console.log('  ✅ Found button, clicking...');
  await searchBtn.asElement().click();
  await sleep(2000);
  await shot(page, '03-scan-started');

  // ─── Step 4: Wait for scan to complete ───
  console.log('\n4️⃣  Waiting for network scan...');

  let scanComplete = false;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);

    const status = await page.evaluate(() => {
      const scanningText = document.body.innerText.includes('Сканирование сети');
      const foundDevices = document.body.innerText.match(/Найдено:\s*(\d+)\s*устройств/);
      const noDevices = document.body.innerText.includes('Камеры не найдены');
      const errorToast = document.body.innerText.includes('Не удалось просканировать');

      return {
        isScanning: scanningText,
        foundCount: foundDevices ? parseInt(foundDevices[1]) : 0,
        noDevices,
        errorToast,
      };
    });

    if (i % 10 === 0) {
      console.log(`  ⏳ ${i}s - scanning: ${status.isScanning}, found: ${status.foundCount}, noDevices: ${status.noDevices}, error: ${status.errorToast}`);
    }

    if (status.errorToast) {
      console.log(`  ❌ Scan error detected after ${i}s`);
      scanComplete = true;
      break;
    }

    if (!status.isScanning && (status.foundCount > 0 || status.noDevices)) {
      scanComplete = true;
      console.log(`  ✅ Scan complete after ${i}s! Found: ${status.foundCount} devices`);
      break;
    }
  }

  if (!scanComplete) {
    console.log('  ⚠️  Scan timed out');
  }

  await shot(page, '04-scan-results');

  // ─── Step 5: Analyze results ───
  console.log('\n5️⃣  Analyzing results...');

  const results = await page.evaluate(() => {
    const items = [];
    const entries = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
    entries.forEach(entry => {
      const name = entry.querySelector('.font-medium')?.textContent?.trim();
      const info = entry.querySelector('.text-xs')?.textContent?.trim();
      const isAdded = entry.textContent?.includes('Добавлена');
      if (name && info && (info.includes('.') || info.includes('порт'))) {
        items.push({ name, info, isAdded });
      }
    });
    return items;
  });

  if (results.length === 0) {
    console.log('  ℹ️  No cameras discovered on the network');
  } else {
    console.log(`  📋 Found ${results.length} camera(s):`);
    results.forEach((cam, i) => {
      console.log(`    ${i + 1}. ${cam.name} — ${cam.info} ${cam.isAdded ? '✓ added' : ''}`);
    });
  }

  // ─── Step 6: Quick-add if available ───
  const addable = results.filter(c => !c.isAdded);
  if (addable.length > 0) {
    console.log(`\n6️⃣  Quick-adding: ${addable[0].name}`);

    const addClicked = await page.evaluate(() => {
      const entries = document.querySelectorAll('[class*="rounded-lg"][class*="border"]');
      for (const entry of entries) {
        if (entry.textContent?.includes('Добавлена')) continue;
        const addBtn = Array.from(entry.querySelectorAll('button')).find(b =>
          b.textContent?.includes('Добавить')
        );
        if (addBtn) { addBtn.click(); return true; }
      }
      return false;
    });

    if (addClicked) {
      console.log('  ✅ Clicked add');
      await sleep(3000);
      await shot(page, '06-after-add');

      const toasts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => t.textContent?.trim()).filter(Boolean);
      });
      if (toasts.length) console.log(`  🔔 Toasts: ${toasts.join(' | ')}`);
    }
  } else {
    console.log('\n6️⃣  No cameras to add');
  }

  // ─── Final ───
  console.log('\n7️⃣  Final state...');
  await page.keyboard.press('Escape');
  await sleep(1000);
  await shot(page, '07-final');

  console.log('\n✅ Test complete! Screenshots: ' + SCREENSHOT_DIR);

  await sleep(2000);
  await browser.close();
})();
