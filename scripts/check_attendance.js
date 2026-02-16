const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Login
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2', timeout: 15000 });
  const emailInput = await page.$('input[type="email"]');
  const passInput = await page.$('input[type="password"]');
  if (emailInput && passInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type('admin@demo.com');
    await passInput.click({ clickCount: 3 });
    await passInput.type('admin123');
    const btn = await page.$('button[type="submit"]');
    if (btn) await btn.click();
    await new Promise(r => setTimeout(r, 4000));
  }

  // Go to attendance page
  await page.goto('http://localhost:3000/attendance', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: '/tmp/attendance_1_desktop.png' });
  console.log('Screenshot 1: desktop attendance page');

  // Open sidebar (click hamburger if visible, or simulate sidebar open)
  // On desktop sidebar is always visible. Let's check mobile view
  await page.setViewport({ width: 390, height: 844 }); // iPhone-like
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/attendance_2_mobile.png' });
  console.log('Screenshot 2: mobile attendance page');

  // Open mobile sidebar
  const menuBtn = await page.$('button:has(svg)'); // hamburger button
  // Click the menu button (first ghost button in header)
  await page.evaluate(() => {
    const btns = document.querySelectorAll('header button');
    btns[0]?.click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/tmp/attendance_3_mobile_sidebar.png' });
  console.log('Screenshot 3: mobile with sidebar open');

  // Back to desktop with sidebar expanded
  await page.setViewport({ width: 1400, height: 900 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: '/tmp/attendance_4_desktop_sidebar.png' });
  console.log('Screenshot 4: desktop with sidebar expanded');

  await browser.close();
})();
