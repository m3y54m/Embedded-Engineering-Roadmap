// Renders the roadmap map to an A4 PDF and a PNG with headless Chromium, straight from the site.
// Also writes a 1200x630 social preview card (Open Graph image) that shows the PNG next to the roadmap's name.
// Usage: node explorer/tools/render.mjs [rootDir] [pagePath] [outDir]
//   defaults: repository root, /explorer/, ./dist        (needs: npm install --no-save playwright)
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { TITLE } from '../dom.js';

const root = resolve(process.argv[2] || '.');
const pagePath = process.argv[3] || '/explorer/';
const outDir = resolve(process.argv[4] || 'dist');
const NAME = 'Embedded-Engineering-Roadmap';
const SOCIAL_NAME = `${NAME}-social.png`;
const PNG_SCALE = 2;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Served by the local server so the card can load the site's font and logo from the same origin.
const socialCard = (base) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<style>
  @font-face { font-family: "Sofia Sans Semi Condensed"; src: url("${base}fonts/SofiaSansSemiCondensed.woff2") format("woff2"); font-weight: 1 1000; }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 40px; padding: 0 72px 0 80px;
    font-family: "Sofia Sans Semi Condensed", "Arial Narrow", sans-serif; color: #e9edf6;
    background: radial-gradient(900px 600px at 8% -10%, rgba(91, 103, 255, 0.28), transparent 62%), radial-gradient(800px 600px at 100% 110%, rgba(20, 184, 166, 0.2), transparent 60%), #060914;
  }
  .copy { flex: 1; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 28px; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; }
  .brand img { width: 56px; height: 56px; }
  h1 { margin-top: 28px; font-size: 72px; line-height: 1.04; font-weight: 800; }
  p { margin-top: 24px; max-width: 560px; font-size: 32px; line-height: 1.3; color: #b6c0d4; }
  .url { margin-top: 36px; font-size: 26px; color: #8fa8ff; }
  .map { flex: none; height: 540px; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.3); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55); }
</style>
<div class="copy">
  <div class="brand"><img src="${base}assets/logo.svg" alt="">Interactive learning path</div>
  <h1>${TITLE}</h1>
  <p>Topics, how they connect and curated learning resources for embedded engineers.</p>
  <div class="url">m3y54m.github.io/Embedded-Engineering-Roadmap</div>
</div>
<img class="map" src="/__roadmap.png" alt="">
`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__social.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] }).end(socialCard(pagePath));
    return;
  }
  if (url.pathname === '/__roadmap.png') {
    try {
      res.writeHead(200, { 'content-type': TYPES['.png'] }).end(await readFile(join(outDir, `${NAME}.png`)));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  const file = resolve(join(root, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : ''));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}${pagePath}`;

const browser = await chromium.launch();
try {
  // bypassCSP lets the PNG step add one style rule; the site itself only allows its own stylesheets.
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: PNG_SCALE, bypassCSP: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.diagram .box');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  });
  if (errors.length) throw new Error(`The page reported errors:\n${errors.join('\n')}`);

  await mkdir(outDir, { recursive: true });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: join(outDir, `${NAME}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });

  // PNG: the same print rendering, at the diagram's own size instead of the page's.
  // page.pdf() fires afterprint, which restores the screen view, so prepare for print again.
  const { w, h } = await page.evaluate(() => {
    const bg = document.querySelector('.diagram .page-bg');
    return { w: Number(bg.getAttribute('width')), h: Number(bg.getAttribute('height')) };
  });
  await page.setViewportSize({ width: Math.ceil(w) + 40, height: Math.ceil(h) + 40 });
  await page.addStyleTag({ content: `.diagram { width: ${w}px !important; height: ${h}px !important; max-height: none !important; }` });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.locator('.diagram').screenshot({ path: join(outDir, `${NAME}.png`) });

  const social = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const card = await social.newPage();
  await card.goto(`http://127.0.0.1:${server.address().port}/__social.html`, { waitUntil: 'networkidle' });
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: join(outDir, SOCIAL_NAME) });

  console.log(`Wrote ${NAME}.pdf, ${NAME}.png (${Math.round(w * PNG_SCALE)}x${Math.round(h * PNG_SCALE)}) and ${SOCIAL_NAME} to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
