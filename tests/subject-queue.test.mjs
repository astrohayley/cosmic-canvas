/**
 * Subjects come from the workflow's Designator queue (`/subjects/queued`), the
 * same endpoint the Zooniverse classifier uses. Designator filters out subjects
 * the volunteer has seen and subjects that are retired, so the app never walks
 * subject sets itself and never cycles back to a subject it already served.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const VIEWPORT = { width: 1280, height: 900 };
const FAKE_BEARER = 'queue-test-bearer';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/subject-117414478.json', import.meta.url)), 'utf8'
));

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

const subject = (id) => ({
  id: String(id),
  metadata: { '#object_id': `s${id}`, '#mask_rle': fixture.mask_rle },
  locations: fixture.locations,
  links: { project: '32203' },
});

/**
 * Fake Panoptes whose queue hands out `batches` in order, one per request.
 */
async function openWithFakeApi({ batches, hash = '' }) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const queued = [];
  const requested = [];
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));

  // A bearer token makes every API call a CORS preflight, so the fake answers those too.
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
  };
  const json = (body) => ({
    status: 200,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify(body),
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url(), baseUrl);
    if (!url.pathname.startsWith('/api/')) return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
    requested.push(url.pathname + url.search);

    if (url.pathname.endsWith('/subjects/queued')) {
      queued.push({ params: url.searchParams, headers: req.headers() });
      const batch = batches[Math.min(queued.length - 1, batches.length - 1)];
      return req.respond(json({ subjects: batch.map(subject) }));
    }
    if (url.pathname.endsWith('/me')) {
      return req.respond(json({ users: [{ id: '1', login: 'queue_user', display_name: 'queue_user' }] }));
    }
    if (url.pathname.includes('/projects/')) {
      return req.respond(json({ projects: [{
        id: '32203',
        display_name: 'Cosmic Canvas',
        links: { subject_sets: ['135370', '138622'] },
      }] }));
    }
    if (url.pathname.includes('/workflows/')) {
      return req.respond(json({ workflows: [{ id: '31480', display_name: 'Galaxy Painter', version: '1.1', links: {} }] }));
    }
    return req.respond(json({ subjects: [] }));
  });

  await page.goto(baseUrl + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  return { page, queued, requested, errors };
}

const currentId = page => page.evaluate(() => {
  const { state } = window.__cosmicCanvas;
  return state.subjects[state.subjectIndex]?.id;
});

test('subjects load from the workflow queue and never from subject sets', async () => {
  const { page, queued, requested, errors } = await openWithFakeApi({ batches: [[1, 2]] });

  assert.equal(await currentId(page), '1');
  assert.ok(queued.length >= 1, 'the queue was asked for subjects');
  assert.equal(queued[0].params.get('workflow_id'), '31480');
  assert.ok(
    !requested.some(p => p.includes('subject_set_id=')),
    `no subject-set walk; saw ${requested.join(', ')}`
  );

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.equal(badge, 'Mask: metadata (loaded)');

  assert.deepEqual(errors, [], errors.join('\n'));
  await page.close();
});

test('running out of queued subjects asks the queue again instead of wrapping', async () => {
  const { page, queued, errors } = await openWithFakeApi({ batches: [[1, 2], [3, 4]] });

  assert.equal(await currentId(page), '1');
  await page.click('#skip-button');
  await page.waitForFunction(() => {
    const { state } = window.__cosmicCanvas;
    return state.subjects[state.subjectIndex]?.id === '2';
  }, { timeout: 10000 });

  await page.click('#skip-button');
  await page.waitForFunction(() => {
    const { state } = window.__cosmicCanvas;
    return state.subjects[state.subjectIndex]?.id === '3';
  }, { timeout: 10000 });

  assert.equal(queued.length, 2, 'a second queue request served the next batch');
  assert.deepEqual(errors, [], errors.join('\n'));
  await page.close();
});

test('a signed-in volunteer asks the queue with their bearer token', async () => {
  const hash = '#' + new URLSearchParams({
    access_token: FAKE_BEARER,
    token_type: 'Bearer',
    expires_in: '7200',
    scope: 'public',
  }).toString();
  const { page, queued, errors } = await openWithFakeApi({ batches: [[1, 2]], hash });

  assert.match(queued[0].headers.authorization || '', new RegExp(`Bearer ${FAKE_BEARER}`));
  assert.deepEqual(errors, [], errors.join('\n'));
  await page.close();
});
