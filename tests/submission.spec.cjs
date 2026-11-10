const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');
let server, base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const file = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const p = path.join(__dirname, '..', file);
    if (!['index.html', 'script.js', 'styles.css'].includes(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(p));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(resolve => server.close(resolve)));
async function setup(page, configure = true) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === base + '/' && configure) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/name="crm-origin" content="[^"]*"/, `name="crm-origin" content="${base}"`);
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (url.startsWith(base)) return route.continue();
    return route.abort();
  });
  await page.goto(base);
}
async function fill(page) {
  await page.locator('#af-name').fill('테스트');
  await page.locator('#af-phone').fill('01012345678');
  await page.locator('#af-count').selectOption('4명 이상');
  await page.locator('#af-grade').fill('초3');
  await page.locator('input[name=subject][value="영어"]').check();
  await page.locator('#af-note').fill('테스트 메모');
  await page.locator('#af-agree').check();
}
test('sends real form values and only confirms a successful response', async ({ page }) => {
  await setup(page); let payload;
  await page.route('**/api/public/education-applications', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afOk')).toBeVisible();
  expect(payload).toMatchObject({ name:'테스트', phone:'010-1234-5678', childCount:'4명 이상', grade:'초3', subjects:['영어'], note:'테스트 메모', consent:true, consentVersion:'2026-11-10' });
  expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/);
});
test('unconfigured never posts or claims success', async ({ page }) => {
  await setup(page, false); await page.locator('meta[name="crm-origin"]').evaluate(el => { el.content = ''; }); await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afOk')).toBeHidden(); await expect(page.locator('#afError')).toBeVisible();
});
test('uncertain failure keeps same body and id on retry, and blocks duplicate while pending', async ({ page }) => {
  await setup(page); const bodies = []; let release;
  await page.route('**/api/public/education-applications', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('failed');
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({status:201, body:'{}'});
  });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afError')).toBeVisible();
  await page.locator('.af-submit').click();
  await expect.poll(() => bodies.length).toBe(2);
  await expect(page.locator('.af-submit')).toBeDisabled();
  expect(bodies[1]).toEqual(bodies[0]); release();
  await expect(page.locator('#afOk')).toBeVisible();
});
test('requires privacy consent and at least one subject', async ({ page }) => {
  await setup(page); await fill(page); await page.locator('#af-agree').uncheck();
  await page.locator('input[name=subject][value="영어"]').uncheck();
  await page.locator('.af-submit').click();
  await expect(page.locator('.af-agree')).toHaveClass(/err/);
  await expect(page.locator('#afOk')).toBeHidden();
});
test('first HTTP 400 allows correction and creates a new request', async ({ page }) => {
  await setup(page); const bodies = [];
  await page.route('**/api/public/education-applications', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({status: bodies.length === 1 ? 400 : 204, body: ''});
  });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afError')).toBeVisible();
  await expect(page.locator('#af-name')).toBeEnabled();
  await page.locator('#af-name').fill('수정'); await page.locator('.af-submit').click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].name).toBe('수정'); expect(bodies[1].requestId).not.toBe(bodies[0].requestId);
  await expect(page.locator('#afOk')).toBeVisible();
});
test('400 after an uncertain attempt preserves the original command', async ({ page }) => {
  await setup(page); const bodies = [];
  await page.route('**/api/public/education-applications', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('failed');
    await route.fulfill({status: 400, body: ''});
  });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afError')).toBeVisible(); await page.locator('.af-submit').click();
  await expect.poll(() => bodies.length).toBe(2);
  await expect(page.locator('#af-name')).toBeDisabled(); expect(bodies[1]).toEqual(bodies[0]);
});
test('rejects invalid phone and overlong CRM fields before sending', async ({ page }) => {
  await setup(page); let calls = 0;
  await page.route('**/api/public/education-applications', async route => { calls++; await route.fulfill({status: 204}); });
  await fill(page); await page.locator('#af-phone').fill('01112345678');
  await page.locator('.af-submit').click(); await expect(page.locator('#af-phone').locator('..')).toHaveClass(/err/); expect(calls).toBe(0);
  await page.locator('#af-phone').fill('01012345678'); await page.locator('#af-name').fill('x'.repeat(81));
  await page.locator('.af-submit').click(); await expect(page.locator('#af-name').locator('..')).toHaveClass(/err/); expect(calls).toBe(0);
  await page.locator('#af-name').fill('테스트'); await page.locator('#af-grade').fill('x'.repeat(101));
  await page.locator('.af-submit').click(); await expect(page.locator('#af-grade').locator('..')).toHaveClass(/err/); expect(calls).toBe(0);
});
test('a stalled request times out without claiming success', async ({ page }) => {
  await page.clock.install(); await setup(page); let arrived = false;
  await page.route('**/api/public/education-applications', async route => {
    arrived = true;
    await new Promise(resolve => setTimeout(resolve, 2000));
    await route.abort().catch(() => {});
  });
  await fill(page); await page.locator('.af-submit').click();
  await expect.poll(() => arrived).toBe(true);
  await page.clock.fastForward(15001);
  await expect(page.locator('#afError')).toBeVisible();
  await expect(page.locator('#afOk')).toBeHidden();
});
