// Links the topics drawn on the map (map.json) to README topics, so every topic knows
// which areas (Software, Hardware, Soft skills) it sits in and how important the map marks it.

export const AREA_ORDER = ['SOFTWARE', 'HARDWARE', 'SOFT SKILLS'];
export const IMPORTANCE_LEVELS = ['required', 'recommended', 'possible'];
const RANK = { required: 3, recommended: 2, possible: 1 };

const key = (text) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function topicIndex(topics) {
  const index = new Map();
  const add = (k, topic) => {
    if (k && !index.has(k)) index.set(k, topic);
  };
  const byDepth = [...topics].sort((a, b) => a.depth - b.depth);
  for (const t of byDepth) add(key(t.title), t);
  for (const t of byDepth) {
    const base = t.title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    add(key(base), t);
    const inner = t.title.match(/\(([^)]+)\)/);
    if (inner && /^[A-Z0-9-]{2,6}$/.test(inner[1])) add(key(inner[1]), t);
    add(key(base.split(' / ')[0]), t);
  }
  return index;
}

export function linkDiagram(map, data) {
  const index = topicIndex(data.topics);
  const softSkills = data.topics.find((t) => t.depth === 1 && key(t.title) === 'soft skills');
  // map.json "readme": map labels whose README heading is worded differently (or has no section of its own).
  const aliases = map.readme || {};
  const resolve = (text, areas = []) => {
    if (Object.hasOwn(aliases, text)) return [aliases[text]].flat().map((title) => index.get(key(title))).filter(Boolean);
    const topic = index.get(key(text));
    if (topic) return [topic];
    if (softSkills && areas.includes('SOFT SKILLS')) return [softSkills];
    return [];
  };

  // A cluster's areas are those of the band it sits in; a group's are the areas all its clusters share.
  const clusterAreas = new Map();
  const clusters = {};
  const boxes = [];
  for (const band of map.bands) {
    for (const [cluster, spec] of Object.entries(band.clusters)) {
      clusterAreas.set(cluster, band.areas);
      clusters[cluster] = { header: spec.header, caption: spec.caption, per: spec.per };
      if (spec.header) boxes.push({ text: spec.header, importance: null, areas: band.areas, cluster, header: true });
      for (const [text, importance] of spec.topics) boxes.push({ text, importance, areas: band.areas, cluster, header: false });
    }
  }
  boxes.forEach((b, i) => Object.assign(b, { id: `box-${i}`, topics: resolve(b.text, b.areas) }));
  const regions = Object.entries(map.groups).map(([name, clusters]) => {
    const areas = AREA_ORDER.filter((a) => clusters.every((c) => (clusterAreas.get(c) || []).includes(a)));
    return { name, clusters, areas, topics: resolve(name) };
  });

  const boxOf = new Map();
  for (const t of data.topics) {
    t.areas = [];
    t.importance = null;
    t.boxes = [];
  }
  for (const box of boxes) {
    for (const t of box.topics) {
      t.boxes.push(box);
      if (!boxOf.has(t)) boxOf.set(t, box);
      for (const area of box.areas) if (!t.areas.includes(area)) t.areas.push(area);
      if (box.importance && (!t.importance || RANK[box.importance] > RANK[t.importance])) t.importance = box.importance;
    }
  }
  for (const region of regions) {
    for (const t of region.topics) {
      for (const area of region.areas) if (!t.areas.includes(area)) t.areas.push(area);
    }
  }
  // Subtopics that are not drawn in the diagram inherit the areas of their closest drawn ancestor.
  for (const t of data.topics) {
    if (!t.areas.length) for (let p = t.parent; p && !t.areas.length; p = p.parent) t.areas = [...(p.areas || [])];
    t.areas.sort((a, b) => AREA_ORDER.indexOf(a) - AREA_ORDER.indexOf(b));
  }

  // The box that stands for a topic on the map: its own, or the closest ancestor's.
  const boxFor = (topic) => {
    for (let t = topic; t; t = t.parent) if (boxOf.has(t)) return boxOf.get(t);
    return null;
  };

  // A connection joins two boxes. `reason` is set for the hand-picked ones in map.json; the rest
  // are evidence only (a shared resource, or one topic's text naming another).
  const pairs = new Map();
  const pairFor = (a, b) => {
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const id = `${p.id}|${q.id}`;
    if (!pairs.has(id)) pairs.set(id, { a: p, b: q, reason: null, weight: 0, shared: 0, links: [] });
    return pairs.get(id);
  };

  const topicBoxes = new Map(boxes.filter((b) => !b.header).map((b) => [b.text, b]));
  const invalidLinks = [];
  for (const box of boxes) box.related = [];
  for (const [from, to, reason] of map.links || []) {
    const a = topicBoxes.get(from);
    const b = topicBoxes.get(to);
    if (!a || !b || a === b || typeof reason !== 'string' || !reason.trim()) {
      invalidLinks.push(`${from} - ${to}`);
      continue;
    }
    const pair = pairFor(a, b);
    if (pair.reason) {
      invalidLinks.push(`${from} - ${to} (listed twice)`);
      continue;
    }
    pair.reason = reason.trim();
    a.related.push({ box: b, reason: pair.reason });
    b.related.push({ box: a, reason: pair.reason });
  }

  for (const link of data.links) {
    const a = boxFor(link.source);
    const b = boxFor(link.target);
    if (!a || !b || a === b) continue;
    const pair = pairFor(a, b);
    pair.weight += link.weight;
    pair.shared += link.shared.length;
    pair.links.push(link);
  }

  return {
    regions,
    clusters,
    boxes,
    boxFor,
    connections: [...pairs.values()],
    unmatched: boxes.filter((b) => !b.header && !b.topics.length).map((b) => b.text),
    invalidLinks,
    invalidReadme: Object.entries(aliases).flatMap(([label, titles]) => {
      const onMap = boxes.some((b) => b.text === label) || label in map.groups;
      const missing = [titles].flat().filter((title) => !index.has(key(title)));
      return onMap && !missing.length ? [] : [`${label} -> ${[titles].flat().join(' + ')}`];
    }),    invalid: boxes.filter((b) => !b.header && !IMPORTANCE_LEVELS.includes(b.importance)).map((b) => `${b.text}: ${b.importance}`),
  };
}
