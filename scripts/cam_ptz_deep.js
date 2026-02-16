const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1200 });
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

  // 1. Find ALL PTZ-related JavaScript functions
  console.log('=== PTZ JavaScript Functions ===');
  const ptzFunctions = await page.evaluate(() => {
    const results = [];
    // Search all script tags for PTZ-related code
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      // Find function definitions related to PTZ, zoom, speed
      const matches = text.match(/function\s+\w*[Pp][Tt][Zz]\w*|function\s+\w*[Zz]oom\w*|function\s+\w*[Ss]peed\w*|ptzslider|TurnUp|ZoomIn|ZoomOut|PTZ\/1/gi);
      if (matches) {
        results.push(...[...new Set(matches)]);
      }
    });
    // Also check for global PTZ functions
    const globals = Object.keys(window).filter(k => /ptz|zoom|speed/i.test(k));
    return { scriptMatches: [...new Set(results)], globalVars: globals };
  });
  console.log('Script matches:', JSON.stringify(ptzFunctions.scriptMatches));
  console.log('Global vars:', JSON.stringify(ptzFunctions.globalVars));

  // 2. Find the ZoomIn/ZoomOut button event handlers
  console.log('\n=== Zoom Button Details ===');
  const zoomButtons = await page.evaluate(() => {
    const results = [];
    ['ZoomIn', 'ZoomOut', 'ZoomWide', 'ZoomTele', 'FocusFar', 'FocusNear', 'IrisOpen', 'IrisClose'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const listeners = el.getAttribute('onclick') || el.getAttribute('onmousedown') || el.getAttribute('onmouseup') || '';
        results.push({
          id,
          tag: el.tagName,
          src: el.src || '',
          title: el.title || '',
          onclick: listeners,
          parentId: el.parentElement?.id || '',
          parentClass: el.parentElement?.className || '',
        });
      }
    });
    return results;
  });
  zoomButtons.forEach(b => console.log(JSON.stringify(b)));

  // 3. Extract all inline scripts that mention PTZ or zoom
  console.log('\n=== PTZ Script Blocks ===');
  const ptzScripts = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      if (/ZoomIn|ZoomOut|ZoomWide|ZoomTele|ptzControl|ptzslider/i.test(text)) {
        // Extract relevant sections
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (/ZoomIn|ZoomOut|ZoomWide|ZoomTele|ptzControl|ptzSlider|Param2|speed/i.test(line)) {
            const context = lines.slice(Math.max(0, i - 2), i + 5).join('\n');
            results.push(context.substring(0, 500));
          }
        });
      }
    });
    return [...new Set(results)].slice(0, 20);
  });
  ptzScripts.forEach((s, i) => {
    console.log(`\n--- Script block ${i} ---`);
    console.log(s);
  });

  // 4. Get all JS files and search for PTZ control logic
  console.log('\n=== External JS Files ===');
  const jsFiles = await page.evaluate(() => {
    return [...document.querySelectorAll('script[src]')].map(s => s.src);
  });
  jsFiles.forEach(f => console.log('  ', f));

  // 5. Fetch and search each JS file for PTZ API calls
  for (const jsUrl of jsFiles) {
    if (/jquery|bootstrap|i18n|select2|slider/i.test(jsUrl)) continue;
    try {
      const content = await page.evaluate(async (url) => {
        const resp = await fetch(url);
        return await resp.text();
      }, jsUrl);

      if (/ZoomIn|ZoomOut|PTZ\/1|ptzControl/i.test(content)) {
        console.log(`\n=== PTZ code in ${jsUrl.split('/').pop()} ===`);
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/ZoomIn|ZoomOut|ZoomWide|ZoomTele|ptzControl|PTZ\/1|Param1|Param2/i.test(line)) {
            const context = lines.slice(Math.max(0, i - 2), i + 8).join('\n');
            console.log(context.substring(0, 600));
            console.log('---');
          }
        });
      }
    } catch (e) {
      // skip
    }
  }

  // 6. Intercept network requests while clicking zoom buttons
  console.log('\n=== Intercepting Network Requests ===');
  const capturedRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/PTZ|ptz|zoom/i.test(url)) {
      capturedRequests.push({
        url,
        method: req.method(),
        postData: req.postData() || '',
        headers: req.headers(),
      });
    }
  });

  // Try clicking zoom in button
  try {
    // First check if there's a mousedown event we should trigger
    await page.evaluate(() => {
      const btn = document.getElementById('ZoomIn') || document.getElementById('ZoomTele');
      if (btn) {
        // Simulate mousedown (PTZ cameras often use mousedown to start, mouseup to stop)
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    // Then mouseup
    await page.evaluate(() => {
      const btn = document.getElementById('ZoomIn') || document.getElementById('ZoomTele');
      if (btn) {
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.log('Click error:', e.message);
  }

  console.log('\nCaptured PTZ requests:');
  capturedRequests.forEach(r => {
    console.log(`  ${r.method} ${r.url}`);
    if (r.postData) console.log(`    Body: ${r.postData}`);
  });

  // 7. Check the ptzslider value and any associated JS
  console.log('\n=== PTZ Slider Analysis ===');
  const sliderInfo = await page.evaluate(() => {
    const slider = document.getElementById('ptzslider');
    const display = document.getElementById('ptzslidervalue');
    const container = document.getElementById('isNvrnoptz');

    // Find what happens when slider changes
    const results = {
      sliderValue: slider?.value,
      displayValue: display?.textContent,
      containerHTML: container?.outerHTML?.substring(0, 500),
    };

    // Search for slider event handlers in all scripts
    document.querySelectorAll('script').forEach(s => {
      const text = s.textContent || '';
      if (/ptzslider|ptzslidervalue|isNvrnoptz/i.test(text)) {
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (/ptzslider|ptzslidervalue/i.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 1), i + 3).join('\n');
            results.sliderCode = (results.sliderCode || '') + '\n' + ctx.substring(0, 300);
          }
        });
      }
    });

    return results;
  });
  console.log('Slider value:', sliderInfo.sliderValue);
  console.log('Display value:', sliderInfo.displayValue);
  console.log('Slider code:', sliderInfo.sliderCode);

  // 8. Check the PTZ config via API directly
  console.log('\n=== PTZ Config via API ===');
  const ptzConfig = await page.evaluate(async () => {
    try {
      const resp = await fetch('/PTZ/1/config');
      return await resp.text();
    } catch (e) {
      return 'Error: ' + e.message;
    }
  });
  console.log(ptzConfig);

  // 9. Check device capabilities for speed ranges
  console.log('\n=== Device Capabilities ===');
  const caps = await page.evaluate(async () => {
    try {
      const resp = await fetch('/System/DeviceCap');
      const text = await resp.text();
      // Extract PTZ-related capabilities
      const lines = text.split('\n').filter(l => /[Pp][Tt][Zz]|[Ss]peed|[Zz]oom|pan|tilt|Motor/i.test(l));
      return lines.join('\n');
    } catch (e) {
      return 'Error: ' + e.message;
    }
  });
  console.log(caps || 'No PTZ capabilities found');

  // 10. Check all PTZ-related API endpoints
  console.log('\n=== PTZ API Endpoints ===');
  const endpoints = [
    '/PTZ/1/config', '/PTZ/1/capabilities', '/PTZ/1/channels',
    '/PTZ/channels/1', '/PTZ/channels/1/capabilities',
    '/PTZ/1/presets', '/PTZ/1/homePosition',
    '/PTZ/1/ZoomIn', '/PTZ/1/ZoomOut',
    '/PTZ/1/speed', '/PTZ/1/motorSpeed',
    '/Zoom/1/config', '/Motor/1/config',
    '/System/PTZ', '/System/PTZ/config',
  ];
  for (const ep of endpoints) {
    const result = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url);
        const text = await resp.text();
        return { status: resp.status, body: text.substring(0, 300) };
      } catch (e) {
        return { status: 0, body: e.message };
      }
    }, ep);
    if (result.status === 200 && !result.body.includes('404') && !result.body.includes('not found')) {
      console.log(`\n  ${ep} (${result.status}):`);
      console.log(`    ${result.body}`);
    }
  }

  await browser.close();
})();
