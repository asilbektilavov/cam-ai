const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.authenticate({ username: 'admin', password: '' });

  console.log('=== Opening camera ===');
  await page.goto('http://192.168.1.55/', { waitUntil: 'networkidle2', timeout: 15000 });

  // Login
  await page.evaluate(() => {
    document.querySelector('#username').value = 'admin';
    document.querySelector('#passwd').value = '';
  });
  await page.click('button[type="submit"]');
  await new Promise(r => setTimeout(r, 3000));

  // Skip password change — click "В другой раз" (id=cancelruomi)
  try {
    await page.click('#cancelruomi');
    console.log('Clicked "В другой раз"');
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log('Skip btn error:', e.message);
  }

  await page.screenshot({ path: '/tmp/cam_main.png' });
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  // Wait more for SPA to load
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/cam_main2.png' });

  // Get full page structure
  const nav = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('a, li, [data-url], [onclick], .treeview, .menu-item, [id]').forEach(el => {
      const text = el.textContent?.trim()?.substring(0, 60);
      if (!text || text.length < 2) return;
      items.push({
        tag: el.tagName,
        text,
        href: el.getAttribute('href'),
        dataUrl: el.getAttribute('data-url'),
        onclick: el.getAttribute('onclick')?.substring(0, 150),
        id: el.id,
        cls: el.className?.substring(0, 50),
      });
    });
    return items;
  });

  console.log('\n=== Page elements ===');
  const seen = new Set();
  nav.forEach(l => {
    const key = (l.text || '').substring(0, 40);
    if (seen.has(key) || key.length < 2) return;
    seen.add(key);
    const extra = l.dataUrl ? ` data-url=${l.dataUrl}` : '';
    const extra2 = l.onclick ? ` onclick=${l.onclick.substring(0, 60)}` : '';
    const extra3 = l.id ? ` id=${l.id}` : '';
    console.log(`  [${l.tag}] "${key}"${extra3}${extra}${extra2}`);
  });

  // Look for PTZ in all JS loaded
  const scripts = await page.evaluate(() => {
    return [...document.querySelectorAll('script[src]')].map(s => s.src);
  });
  console.log('\n=== Loaded scripts ===');
  scripts.forEach(s => console.log('  ', s));

  // Check HTML for PTZ keywords
  const html = await page.content();
  console.log('\n=== Page HTML length:', html.length);
  const keywords = ['PTZ', 'ptz', 'zoom', 'Zoom', 'speed', 'Speed', 'скорост', '云台', '变倍', '变焦'];
  keywords.forEach(kw => {
    const count = (html.match(new RegExp(kw, 'gi')) || []).length;
    if (count > 0) console.log(`  "${kw}": ${count} occurrences`);
  });

  await browser.close();
})();
