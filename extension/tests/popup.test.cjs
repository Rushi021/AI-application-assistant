const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

test('JD is directly editable above the action bar and popup does not collapse to its initial viewport', async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:340, height:314}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.chrome = {storage:{local:{get:async()=>({})}}, runtime:{openOptionsPage:async()=>{}}};
    });
    await page.route('http://localhost:8000/**', route => route.fulfill({json:route.request().url().endsWith('/queue') ? [] : {}}));
    await page.route('https://assistant.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.join(__dirname, '..', pathname);
      const contentType = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
      await route.fulfill({contentType, body:await readFile(file)});
    });
    await page.goto('https://assistant.test/src/popup/popup.html');
    const initial = await page.locator('body').boundingBox();
    assert.ok(initial.width >= 700, 'Popup must request enough width during Chrome autosizing');
    assert.ok(initial.height >= 590, 'Popup must not be clamped to the initial short viewport');
    await page.setViewportSize({width:760, height:600});
    const field = page.locator('#jd');
    const box = await field.boundingBox();
    const footer = await page.locator('.action-bar').boundingBox();
    assert.ok(box.height >= 200, 'JD field should show several paragraphs');
    assert.ok(box.y >= 0 && box.y + box.height <= footer.y, 'JD must be fully visible without scrolling');
    await field.fill('Required: Python and SQL. Build reliable AI applications.');
    assert.match(await field.inputValue(), /Python and SQL/);
    assert.equal(await page.locator('#mainContent').evaluate(el=>el.scrollTop), 0);
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth > el.clientWidth), false);
    assert.deepEqual(errors, []);
    if (process.env.POPUP_SCREENSHOT) await page.screenshot({path:process.env.POPUP_SCREENSHOT});
  } finally {
    await browser.close();
  }
});
