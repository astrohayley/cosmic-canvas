/**
 * The workflow queue can serve subjects from a set that predates the mask
 * metadata. When that happens the app looks through the project's own subject
 * sets for one whose subjects carry `#mask_rle`, so volunteers get the machine
 * guess rather than a threshold approximation of it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const VIEWPORT = { width: 1280, height: 900 };

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

const subject = (id, { withMask }) => ({
  id: String(id),
  metadata: withMask
    ? { '#object_id': `s${id}`, '#mask_rle': fixture.mask_rle }
    : { '#object_id': `s${id}` },
  locations: fixture.locations,
  links: { project: '32203' },
});

/**
 * Fake Panoptes: a queue with no masks, a project linking two subject sets,
 * and masks only in the later one.
 */
async function openWithFakeApi({ queueHasMask, maskedSetId = '138622' }) {
  // The project always links the same two sets; `maskedSetId` decides which of
  // them (if either) carries `#mask_rle`.
  const projectSubjectSets = ['135370', '138622'];
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const requested = [];
  const errors = [];
  page.on('pageerror', e => errors.push(`PAGEERROR: ${e.message}`));
  page._capturedErrors = errors;
  page._requested = requested;

  const json = (body) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url(), baseUrl);
    if (!url.pathname.startsWith('/api/')) return req.continue();
    requested.push(url.pathname + url.search);

    if (url.pathname.endsWith('/subjects/queued')) {
      return req.respond(json({ subjects: [subject(1, { withMask: queueHasMask })] }));
    }
    if (url.pathname.endsWith('/subjects')) {
      const setId = url.searchParams.get('subject_set_id');
      return req.respond(json({ subjects: [subject(setId, { withMask: setId === maskedSetId })] }));
    }
    if (url.pathname.includes('/projects/')) {
      return req.respond(json({ projects: [{
        id: '32203',
        display_name: 'Cosmic Canvas',
        links: { subject_sets: projectSubjectSets },
      }] }));
    }
    if (url.pathname.includes('/workflows/')) {
      return req.respond(json({ workflows: [{ id: '31480', display_name: 'Galaxy Painter', version: '1.1', links: {} }] }));
    }
    return req.continue();
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-classify:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => window.__cosmicCanvas?.brush?.ready === true, { timeout: 30000 });
  return page;
}

test('a mask-less queue falls through to a project subject set that has masks', async () => {
  const page = await openWithFakeApi({ queueHasMask: false });

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.equal(badge, 'Mask: metadata (loaded)');

  const subjectId = await page.evaluate(() => window.__cosmicCanvas.state.subjects[0].id);
  assert.equal(subjectId, '138622', 'the masked set should win over the queued subject');

  assert.ok(
    page._requested.some(p => p.includes('subject_set_id=138622')),
    `expected a subject_set_id lookup; saw ${page._requested.join(', ')}`
  );

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('a queue that already carries masks is used as-is', async () => {
  const page = await openWithFakeApi({ queueHasMask: true });

  const subjectId = await page.evaluate(() => window.__cosmicCanvas.state.subjects[0].id);
  assert.equal(subjectId, '1', 'the queued subject should be kept');

  assert.ok(
    !page._requested.some(p => p.includes('subject_set_id=')),
    'no subject-set walk should happen when the queue is already good'
  );

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});

test('when no set has masks, the queued subjects are still used', async () => {
  const page = await openWithFakeApi({ queueHasMask: false, maskedSetId: null });

  const subjectId = await page.evaluate(() => window.__cosmicCanvas.state.subjects[0].id);
  assert.equal(subjectId, '1', 'the app must fall back to the queue, not show an empty state');

  const badge = await page.$eval('#mask-info-badge', el => el.textContent.trim());
  assert.match(badge, /^Mask: threshold-fallback/);

  assert.equal(page._capturedErrors.length, 0, page._capturedErrors.join('\n'));
  await page.close();
});
