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

  // Skip password change
  await page.click('#cancelruomi').catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  // Screenshot 1: PTZ panel on preview page
  await page.screenshot({ path: '/tmp/cam_ptz_preview.png' });
  console.log('Screenshot 1: PTZ preview panel');

  // Get the PTZ panel HTML with speed controls
  const ptzHtml = await page.evaluate(() => {
    const el = document.querySelector('#previewyt');
    return el ? el.innerHTML : 'NOT FOUND';
  });
  console.log('\n=== PTZ Preview Panel HTML ===');
  console.log(ptzHtml.substring(0, 2000));

  // Get the speed slider/control
  const speedInfo = await page.evaluate(() => {
    // Look for speed-related elements
    const results = [];
    document.querySelectorAll('input[type="range"], .range, .slider, [id*="speed"], [id*="Speed"], [class*="speed"]').forEach(el => {
      results.push({
        tag: el.tagName,
        id: el.id,
        type: el.type,
        min: el.min,
        max: el.max,
        value: el.value,
        class: el.className?.substring(0, 50),
      });
    });
    return results;
  });
  console.log('\n=== Speed controls ===');
  speedInfo.forEach(s => console.log(JSON.stringify(s)));

  // Now navigate to PTZ config page
  console.log('\n=== Opening PTZ Config ===');
  await page.click('#ptzcfg').catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/cam_ptz_config.png' });
  console.log('Screenshot 2: PTZ config page');

  // Get config page content
  const configHtml = await page.evaluate(() => {
    const main = document.querySelector('#main') || document.querySelector('.main-content');
    return main ? main.innerHTML : document.body.innerHTML;
  });

  // Extract PTZ-related parts
  const lines = configHtml.split(/[<>]/).filter(l => /ptz|PTZ|speed|Speed|скорост|протокол|Protocol|bitrate|Bitrate|адрес|Address/i.test(l));
  console.log('\n=== PTZ config elements ===');
  lines.slice(0, 30).forEach(l => console.log('  ', l.trim().substring(0, 120)));

  // Get all form inputs in config
  const inputs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('#main input, #main select, #main [type="range"]').forEach(el => {
      results.push({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        value: el.value,
        min: el.min,
        max: el.max,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ text: o.text, value: o.value })) : undefined,
      });
    });
    return results;
  });
  console.log('\n=== Config form inputs ===');
  inputs.forEach(i => console.log(JSON.stringify(i)));

  await browser.close();
})();
