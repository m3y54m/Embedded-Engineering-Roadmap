// Renders the roadmap map to an A4 PDF and a PNG with headless Chromium, straight from the site.
// Usage: node site/tools/render.mjs [rootDir] [pagePath] [outDir]
//   defaults: repository root, /site/, ./dist        (needs: npm install --no-save playwright)
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] || '.');
const pagePath = process.argv[3] || '/site/';
const outDir = resolve(process.argv[4] || 'dist');
const NAME = 'Embedded-Engineering-Roadmap';
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
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

  console.log(`Wrote ${NAME}.pdf and ${NAME}.png (${Math.round(w * PNG_SCALE)}x${Math.round(h * PNG_SCALE)}) to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
