const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
let server, base, staleRequests = 0;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/cache-seed') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script src="/script.js"></script>');
      return;
    }
    if (req.url === '/script.js') {
      staleRequests++;
      res.setHeader('Content-Type', 'text/javascript');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end('window.preIntegrationScript = true;');
      return;
    }
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
test('refreshed HTML requests the current script instead of cached pre-integration JS', async ({ page }) => {
  await page.goto(base + '/cache-seed');
  expect(await page.evaluate(() => window.preIntegrationScript)).toBe(true);
  expect(staleRequests).toBe(1);
  await page.goto(base + '/cache-seed');
  expect(await page.evaluate(() => window.preIntegrationScript)).toBe(true);
  expect(staleRequests).toBe(1); // The second load actually reused the cached old script.
  await page.goto(base);
  expect(staleRequests).toBe(1);
  await page.reload();
  const scriptURL = await page.locator('script[src]').last().getAttribute('src');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'script.js'))).digest('hex');
  expect(scriptURL).toBe(`script.js?v=${digest}`);
  expect(await page.evaluate(() => window.preIntegrationScript)).toBeUndefined();
  await page.locator('meta[name="crm-origin"]').evaluate(el => { el.content = ''; });
  await fill(page);
  await page.locator('.af-submit').click();
  await expect(page.locator('#afError')).toBeVisible();
  await expect(page.locator('#afOk')).toBeHidden();
});
async function setup(page, configure = true, search = '') {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if ((url === base + '/' || url.startsWith(base + '/?')) && configure) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/name="crm-origin" content="[^"]*"/, `name="crm-origin" content="${base}"`);
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    if (url.startsWith(base)) return route.fallback(); // 먼저 등록한 가로채기(방문 집계 등)가 있으면 그쪽이 처리한다
    return route.abort();
  });
  await page.goto(base + (search ? '/' + search : ''));
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

// 방문 집계(2026-11-17): 유입 경로와 횟수만 CRM에 알린다. 개인정보는 보내지 않는다.
async function captureVisits(page) {
  const visits = [];
  await page.route('**/api/public/education-visits', async route => {
    visits.push(route.request().postDataJSON());
    await route.fulfill({ status: 204, body: '' });
  });
  return visits;
}
test('reports a page view with the ?from= source and marks only the first visit of the day', async ({ page }) => {
  const visits = await captureVisits(page);
  await setup(page, true, '?from=sk');
  await expect.poll(() => visits.length).toBe(1);
  expect(visits[0]).toEqual({ event: 'view', source: 'sk', first: true });
  await page.reload();
  await expect.poll(() => visits.length).toBe(2);
  expect(visits[1]).toEqual({ event: 'view', source: 'sk', first: false });
  // 같은 탭에서 ?from 없이 다시 열어도 처음 들어온 경로를 유지한다.
  await page.goto(base);
  await expect.poll(() => visits.length).toBe(3);
  expect(visits[2]).toEqual({ event: 'view', source: 'sk', first: false });
});
test('a visit without ?from= has no source, and unsafe values are dropped', async ({ page, context }) => {
  const visits = await captureVisits(page);
  await setup(page);
  await expect.poll(() => visits.length).toBe(1);
  expect(visits[0]).toEqual({ event: 'view', first: true });
  const other = await context.newPage();
  const otherVisits = await captureVisits(other);
  await setup(other, true, '?from=' + encodeURIComponent('<script>alert(1)</script>'));
  await expect.poll(() => otherVisits.length).toBe(1);
  expect(otherVisits[0]).toEqual({ event: 'view', first: false }); // 같은 브라우저의 두 번째 방문
  const campaign = await context.newPage();
  const campaignVisits = await captureVisits(campaign);
  await setup(campaign, true, '?utm_source=SK-CLE20261116');
  await expect.poll(() => campaignVisits.length).toBe(1);
  expect(campaignVisits[0]).toEqual({ event: 'view', source: 'sk-cle20261116', first: false });
});
test('a successful application reports one submit without any form values', async ({ page }) => {
  const visits = await captureVisits(page);
  await setup(page, true, '?from=sk');
  await page.route('**/api/public/education-applications', async route => { await route.fulfill({ status: 204, body: '' }); });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afOk')).toBeVisible();
  await expect.poll(() => visits.length).toBe(2);
  expect(visits[1]).toEqual({ event: 'submit', source: 'sk' });
  for (const visit of visits) expect(JSON.stringify(visit)).not.toMatch(/테스트|010|초3|영어|requestId/);
});
test('a failed application does not report a submit', async ({ page }) => {
  const visits = await captureVisits(page);
  await setup(page);
  await page.route('**/api/public/education-applications', async route => { await route.fulfill({ status: 400, body: '' }); });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afError')).toBeVisible();
  expect(visits.filter(v => v.event === 'submit')).toEqual([]);
});
test('a page opened locally never reports visits to the production CRM', async ({ page }) => {
  const external = [];
  page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
  await setup(page, false, '?from=sk'); // crm-origin 은 운영 주소 그대로
  await page.waitForTimeout(300);
  expect(external.filter(url => url.includes('education-visits'))).toEqual([]);
});
test('a tracking failure never blocks the page or the application', async ({ page }) => {
  await page.route('**/api/public/education-visits', route => route.abort('failed'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page, true, '?from=sk');
  await page.route('**/api/public/education-applications', async route => { await route.fulfill({ status: 204, body: '' }); });
  await fill(page); await page.locator('.af-submit').click();
  await expect(page.locator('#afOk')).toBeVisible();
  expect(errors).toEqual([]);
});
