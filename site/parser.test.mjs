import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoadmap, renderInline } from './parser.js';
import { linkDiagram } from './diagram.js';
import { SPACE, buildLayout } from './layout.js';

const data = parseRoadmap(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
const find = (title) => data.topics.find((t) => t.title === title);
const linked = (a, b) => data.links.find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a));

test('builds the topic tree from the README headings', () => {
  assert.ok(data.topics.length > 100);
  assert.equal(find('Microcontrollers').depth, 1);
  assert.ok(find('Microcontrollers').children.some((c) => c.title === 'GPIO'));
  assert.equal(find('1-Wire').parent.title, 'Basic Protocols');
  assert.equal(find('High-Performance Computing (HPC)').parent.title, 'Multithreading & Parallel Processing');
  assert.equal(find('History'), undefined);
  assert.deepEqual(data.groups.map((g) => g.title), ["Don't Know Where to Start!", 'Learning Resources']);
});

test('gives every topic a unique slug', () => {
  assert.equal(new Set(data.topics.map((t) => t.slug)).size, data.topics.length);
});

test('parses resource markers, bracketed titles and URLs with parentheses', () => {
  const beej = find('C').resources.find((r) => r.title.startsWith("Beej's Guide"));
  assert.deepEqual([beej.type, beej.beginner, beej.gem], ['book', true, false]);
  const j1939 = find('CAN').resources.find((r) => r.title.startsWith('J1939'));
  assert.equal(j1939.title, 'J1939 Explained - A Simple Intro [v2.0 | 2021]');
  assert.match(find('PCM').resources[0].url, /_04\(1\)\.pdf$/);
  assert.equal(find('GoogleTest - Google Testing and Mocking Framework').resources[0].url, 'https://github.com/google/googletest');
  assert.match(find('Career Development').resources[0].note, /job board/);
});

test('keeps descriptions and the README introduction', () => {
  assert.match(data.root.description[0].text, /^This roadmap is designed/);
  assert.match(find('Microcontrollers').description[0].text, /^Microcontrollers are integrated circuits/);
});

test('links topics that share a resource or mention each other', () => {
  assert.ok(linked(find('Docker'), find('CI/CD Pipelines')).shared.length > 0);
  assert.ok(linked(find('I2C'), find('Sensors')).mentions.length > 0);
  assert.equal(linked(find('Microcontrollers'), find('GPIO')), undefined, 'parent and child are not cross-linked');
  assert.equal(linked(find('Thread'), find('RT-Thread')), undefined, 'RT-Thread is not a mention of Thread');
});

test('renderInline escapes HTML and only links http(s) URLs', () => {
  assert.equal(
    renderInline('<b>x</b> **y** [a](https://e.com/?q=1&r=2) [j](javascript:alert(1))'),
    '&lt;b&gt;x&lt;/b&gt; <strong>y</strong> <a href="https://e.com/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">a</a> [j](javascript:alert(1))',
  );
});

const map = JSON.parse(readFileSync(new URL('./map.json', import.meta.url), 'utf8'));

test('places topics in the map areas and their cross-section', () => {
  const plan = linkDiagram(map, data);
  assert.deepEqual(plan.unmatched, [], 'every map topic matches a README heading (or an alias in diagram.js)');
  assert.deepEqual(plan.invalid, [], 'importance is required, recommended or possible');
  assert.deepEqual(find('GPIO').areas, ['SOFTWARE', 'HARDWARE']);
  assert.deepEqual(find('I2C').areas, ['SOFTWARE', 'HARDWARE']);
  assert.deepEqual(find('Sensors & Actuators').areas, ['SOFTWARE', 'HARDWARE']);
  assert.deepEqual(find('GDB').areas, ['SOFTWARE']);
  assert.deepEqual(find('Oscilloscope').areas, ['HARDWARE']);
  assert.deepEqual(find('Soft Skills').areas, ['SOFT SKILLS']);
  assert.deepEqual(find('Microcontrollers').areas, ['SOFTWARE', 'HARDWARE']);
  assert.equal(find('RTOS Basics').importance, 'required');
  assert.equal(find('Rust').importance, 'possible');
  assert.deepEqual(find('Linux Device Drivers').areas, ['SOFTWARE']);
  assert.equal(find('Projects').areas.length, 0, 'getting-started topics are not on the map');
});

test('lays the map out on one A4 page with a minimum spacing between boxes', () => {
  const layout = buildLayout(linkDiagram(map, data));
  assert.deepEqual(layout.missing, [], 'every cluster in map.json has a place in layout.js');
  assert.ok(layout.height / layout.width <= Math.SQRT2, 'fits A4 portrait');
  const boxes = layout.items.filter((i) => i.kind === 'box');
  const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const gap = (a, b) => Math.max(b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.h, a.y - b.y - b.h);
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) assert.ok(gap(a, b) >= SPACE - 0.01, `${a.text} / ${b.text}`);
    for (const g of layout.groups) {
      if (!inside(a, g.rect)) continue;
      const r = g.rect;
      const d = Math.min(a.x - r.x, a.y - r.y, r.x + r.w - a.x - a.w, r.y + r.h - a.y - a.h);
      assert.ok(d >= SPACE - 0.01, `${a.text} too close to the ${g.name} outline`);
    }
  }
});
