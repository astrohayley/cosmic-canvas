import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const VIEWPORT = { width: 1280, height: 900 };
const FAKE_BEARER = 'test-bearer-token';
const FAKE_USER = 'test_user';

let server, browser, baseUrl;

before(async () => {
  server = await startServer();
  baseUrl = server.url;
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  page._capturedErrors = errors;
  return page;
}

async function waitForClassifyReady(page) {
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
}

async function waitForSubmissionResult(page, timeout = 30000) {
  await page.waitForFunction(
    () => !document.querySelector('#submission-result').hidden,
    { timeout }
  );
}

test('page loads with jQuery and styled root', async () => {
  const page = await newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const probe = await page.evaluate(() => ({
    jq: window.jQuery?.fn?.jquery,
    appBg: getComputedStyle(document.querySelector('.app')).backgroundColor,
    appColor: getComputedStyle(document.querySelector('.app')).color,
  }));
  assert.ok(probe.jq?.startsWith('3.'), `expected jQuery 3.x, got ${probe.jq}`);
  assert.equal(probe.appBg, 'rgb(40, 44, 52)');
  assert.equal(probe.appColor, 'rgb(255, 255, 255)');
  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('anonymous classification submits to Panoptes and returns 201', async () => {
  const page = await newPage();

  let postBody = null;
  let postStatus = null;
  page.on('response', (res) => {
    if (res.request().method() === 'POST' && res.url().endsWith('/api/classifications')) {
      postBody = JSON.parse(res.request().postData());
      postStatus = res.status();
    }
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForClassifyReady(page);

  await page.click('#submit-button');
  await waitForSubmissionResult(page);

  assert.equal(postStatus, 201, `classification POST should be 201, got ${postStatus}`);

  const cls = postBody.classifications;
  assert.equal(cls.annotations[0].task, 'T0');
  assert.equal(typeof cls.annotations[0].value, 'string');
  assert.equal(cls.completed, true);
  assert.equal(cls.links.project, '32203');
  assert.equal(cls.links.workflow, '31480');
  assert.match(cls.links.subjects[0], /^\d+$/);

  for (const key of ['workflow_version', 'started_at', 'finished_at', 'user_agent', 'user_language', 'utc_offset', 'source', 'viewport']) {
    assert.ok(key in cls.metadata, `metadata.${key} missing`);
  }

  await page.close();
});

test('brush strokes serialize to a one-based start/length RLE string', async () => {
  const page = await newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForClassifyReady(page);

  // Wait for the seed to land, then clear it so we isolate the user stroke.
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  await page.click('#brush-clear');
  await new Promise(r => setTimeout(r, 50));

  const box = await page.evaluate(() => {
    const r = document.getElementById('brush-canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + 100 + i * 15, box.y + 100 + Math.sin(i / 3) * 30);
  }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 100));

  const rle = await page.evaluate(() => window.__cosmicCanvas.getMaskRle());
  assert.match(rle, /^\d+( \d+)*$/, 'the wire format is whitespace-delimited integers');

  const tokens = rle.split(' ').map(Number);
  assert.equal(tokens.length % 2, 0, 'tokens must pair as start/length');
  assert.ok(tokens.every(n => Number.isSafeInteger(n) && n >= 1), 'starts and lengths are one-based');

  const dimensions = await page.evaluate(() => window.__cosmicCanvas.brush.dimensions);
  assert.equal(dimensions.width, 500);
  assert.equal(dimensions.height, 500);
  const highest = Math.max(...tokens.filter((_, i) => i % 2 === 0)
    .map((start, i) => start - 1 + tokens[i * 2 + 1]));
  assert.ok(highest <= dimensions.width * dimensions.height, 'runs stay inside the raster');

  await page.click('#brush-undo');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(await page.evaluate(() => window.__cosmicCanvas.getMaskRle()), '');

  await page.close();
});

test('sign-in builds authorize URL with response_type=token (implicit grant) and configured client_id', async () => {
  const page = await newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForClassifyReady(page);

  let intercepted = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith('https://panoptes.zooniverse.org/oauth/authorize')) {
      intercepted = req.url();
      req.abort();
    } else {
      req.continue();
    }
  });

  const oauth = await page.evaluate(() => window.__cosmicCanvas.OAUTH);
  await page.click('#auth-button');
  await new Promise(r => setTimeout(r, 500));

  assert.ok(intercepted, 'clicking Sign in should redirect to /oauth/authorize');
  const u = new URL(intercepted);
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('client_id'), oauth.clientId);
  assert.equal(u.searchParams.get('redirect_uri'), baseUrl);
  assert.equal(u.searchParams.get('scope'), oauth.scope);

  await page.close();
});

const isApiMe = (url) => /\/api\/me(\?|$)/.test(url);

test('#access_token callback persists the bearer and authenticates classifications', async () => {
  const page = await newPage();

  let classificationHeaders = null;

  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    const method = req.method();

    if (isApiMe(url) && method === 'GET') {
      await req.respond({
        status: 200,
        contentType: 'application/vnd.api+json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ users: [{ id: '1', login: FAKE_USER, display_name: FAKE_USER }] }),
      });
      return;
    }

    if (url.endsWith('/api/classifications') && method === 'POST') {
      classificationHeaders = req.headers();
      await req.respond({
        status: 201,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ classifications: [{ id: 'mock', links: { user: '1' } }] }),
      });
      return;
    }

    req.continue();
  });

  // Doorkeeper's implicit-grant callback returns the token in the URL fragment.
  const hash = new URLSearchParams({
    access_token: FAKE_BEARER,
    token_type: 'Bearer',
    expires_in: '7200',
    scope: 'public classification',
  }).toString();
  await page.goto(baseUrl + '#' + hash, { waitUntil: 'domcontentloaded' });
  await waitForClassifyReady(page);
  await page.waitForFunction(() => {
    const t = sessionStorage.getItem('cosmic_canvas_token');
    if (!t) return false;
    try { return !!JSON.parse(t).user; } catch (_) { return false; }
  }, { timeout: 10000 });

  assert.equal(await page.url(), baseUrl, '#access_token should be scrubbed from the URL after pickup');

  const status = await page.$eval('#header-status', el => el.textContent);
  assert.match(status, new RegExp(FAKE_USER));

  await page.click('#submit-button');
  await waitForSubmissionResult(page, 15000);

  assert.match(
    classificationHeaders.authorization || '',
    new RegExp(`Bearer ${FAKE_BEARER}`),
    'classification POST should carry Authorization: Bearer'
  );

  await page.close();
});
