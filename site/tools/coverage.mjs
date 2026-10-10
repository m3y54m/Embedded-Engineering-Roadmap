// Warns (never fails) about README sections that have no place on the map yet.
// Usage: node site/tools/coverage.mjs        Sections listed in map.json "offMap" (titles or group names) are skipped.
import { readFileSync } from 'node:fs';
import { parseRoadmap } from '../parser.js';
import { linkDiagram } from '../diagram.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const map = JSON.parse(read('../map.json'));
const data = parseRoadmap(read('../../README.md'));
const plan = linkDiagram(map, data);

const drawn = new Set(plan.boxes.flatMap((b) => b.topics));
const onMap = (t) => drawn.has(t) || t.children.some(onMap);
const skipped = new Set(map.offMap || []);
const missing = data.root.children.filter((t) => !skipped.has(t.title) && !skipped.has(t.group) && !onMap(t));

for (const t of missing) {
  console.log(`::warning file=README.md,title=Not on the roadmap map::"${t.title}" has no box on the map. Add it to site/map.json, or to "offMap" if it should stay off the map (see CONTRIBUTING.md).`);
}
console.log(missing.length ? `${missing.length} README section(s) are not on the map.` : 'Every README section is on the map or listed in "offMap".');
