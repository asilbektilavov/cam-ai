const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.authenticate({ username: 'admin', password: '' });

  await page.goto('http://192.168.1.55/', { waitUntil: 'networkidle2', timeout: 15000 });

  // Login
  await page.evaluate(() => {
    document.querySelector('#username').value = 'admin';
    document.querySelector('#passwd').value = '';
  });
  await page.click('button[type="submit"]');
  await new Promise(r => setTimeout(r, 3000));
  await page.click('#cancelruomi').catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  // Fetch preview.js and extract PTZ logic
  console.log('=== Fetching preview.js ===');
  const previewJs = await page.evaluate(async () => {
    const resp = await fetch('/js/pages/preview.js?m=0.1377994583418516');
    return await resp.text();
  });

  // Extract PTZControl function and related code
  console.log('\n=== PTZControl function ===');
  const lines = previewJs.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (/PTZControl|ptzControl|function.*PTZ/i.test(lines[i])) {
      const ctx = lines.slice(Math.max(0, i - 2), i + 30).join('\n');
      console.log(ctx.substring(0, 1500));
      console.log('\n---BREAK---\n');
    }
  }

  // Search for ZoomIn/ZoomOut handlers
  console.log('\n=== ZoomIn/ZoomOut handlers ===');
  for (let i = 0; i < lines.length; i++) {
    if (/ZoomIn|ZoomOut|ZoomWide|ZoomTele/i.test(lines[i])) {
      const ctx = lines.slice(Math.max(0, i - 3), i + 10).join('\n');
      console.log(ctx.substring(0, 800));
      console.log('\n---BREAK---\n');
    }
  }

  // Search for speed/slider related code
  console.log('\n=== Speed/Slider code ===');
  for (let i = 0; i < lines.length; i++) {
    if (/ptzslider|ptzslidervalue|Param2|speed.*val/i.test(lines[i])) {
      const ctx = lines.slice(Math.max(0, i - 3), i + 10).join('\n');
      console.log(ctx.substring(0, 800));
      console.log('\n---BREAK---\n');
    }
  }

  // Get the global PTZControl function definition
  console.log('\n=== Global PTZControl ===');
  const ptzDef = await page.evaluate(() => {
    if (typeof PTZControl === 'function') {
      return PTZControl.toString().substring(0, 2000);
    }
    return 'PTZControl is not a function: ' + typeof PTZControl;
  });
  console.log(ptzDef);

  // Get getPTZCfg function
  console.log('\n=== getPTZCfg ===');
  const getCfg = await page.evaluate(() => {
    if (typeof getPTZCfg === 'function') return getPTZCfg.toString().substring(0, 1000);
    return typeof getPTZCfg;
  });
  console.log(getCfg);

  // Get setPTZCfg function
  console.log('\n=== setPTZCfg ===');
  const setCfg = await page.evaluate(() => {
    if (typeof setPTZCfg === 'function') return setPTZCfg.toString().substring(0, 1000);
    return typeof setPTZCfg;
  });
  console.log(setCfg);

  // Get getPTZPower function
  console.log('\n=== getPTZPower ===');
  const getPower = await page.evaluate(() => {
    if (typeof getPTZPower === 'function') return getPTZPower.toString().substring(0, 1000);
    return typeof getPTZPower;
  });
  console.log(getPower);

  // Get gs_ptz_cfg value
  console.log('\n=== gs_ptz_cfg ===');
  const ptzCfg = await page.evaluate(() => {
    return JSON.stringify(gs_ptz_cfg);
  });
  console.log(ptzCfg);

  // Try setting slider to different values and capture request
  console.log('\n=== Testing slider value change ===');
  const capturedReqs = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/PTZ/i.test(url)) {
      capturedReqs.push({
        url: url.replace('http://192.168.1.55', ''),
        method: req.method(),
        body: req.postData() || '',
      });
    }
  });

  // Change slider to 1 and click zoom
  await page.evaluate(() => {
    document.getElementById('ptzslider').value = '1';
    document.getElementById('ptzslidervalue').textContent = '1';
  });

  await page.evaluate(() => {
    const btn = document.getElementById('ZoomIn');
    if (btn) {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => {
    const btn = document.getElementById('ZoomIn');
    if (btn) {
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 500));

  console.log('Requests with slider=1:');
  capturedReqs.forEach(r => console.log(`  ${r.method} ${r.url} body=${r.body}`));

  await browser.close();
})();
