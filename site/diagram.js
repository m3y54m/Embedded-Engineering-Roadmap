// Links the topics drawn on the map (map.json) to README topics, so every topic knows
// which areas (Software, Hardware, Soft skills) it sits in and how important the map marks it.

// Map labels whose README heading is worded differently.
const ALIASES = {
  'ADC / DAC': ['ADC', 'DAC'],
  'Buildroot / Yocto': ['Buildroot', 'Yocto'],
  'TDD & Unit Testing': ['Test Driven Development (TDD)', 'Unit Testing'],
  'Threading / Parallelism': ['Multithreading & Parallel Processing'],
  'Device Drivers': ['Linux Device Drivers'],
  'Real-Time OS': ['Real-Time Operating Systems'],
  'Interfaces & Protocols': ['Interfaces, Protocols & Communication Technologies'],
  Basic: ['Basic Protocols'],
  'High-Speed': ['High-Speed Protocols'],
  Wireless: ['Wireless Protocols'],
  Industrial: ['Industrial Protocols'],
  Automotive: ['Automotive Protocols'],
  Network: ['Network Protocols / Socket Programming'],
  'TCP/IP': ['Network Protocols / Socket Programming'],
  UDP: ['Network Protocols / Socket Programming'],
  Cellular: ['Cellular Communication'],
  MQTT: ['CoAP & MQTT'],
  CoAP: ['CoAP & MQTT'],
  'LTE-M / 5G': ['LTE-M & NB-IoT'],
  'NB-IoT': ['LTE-M & NB-IoT'],
  'Basic Math & Calculus': ['Basic Calculus'],
  'SDLC Models': ['Software Development Life Cycle (SDLC) Models'],
  'Version Control': ['Version Control Systems'],
  AUTOSAR: ['AUTOSAR Architecture'],
  // Drawn on the map but without their own README section: open the protocol family instead.
  Profinet: ['Industrial Protocols'],
  LIN: ['Automotive Protocols'],
  MOST: ['Automotive Protocols'],
  FlexRay: ['Automotive Protocols'],
  UWB: ['Wireless Protocols'],
};

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
  const resolve = (text, areas = []) => {
    if (ALIASES[text]) return ALIASES[text].map((title) => index.get(key(title))).filter(Boolean);
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

  const pairs = new Map();
  for (const link of data.links) {
    const a = boxFor(link.source);
    const b = boxFor(link.target);
    if (!a || !b || a === b) continue;
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const id = `${p.id}|${q.id}`;
    if (!pairs.has(id)) pairs.set(id, { a: p, b: q, weight: 0, shared: 0, links: [] });
    const pair = pairs.get(id);
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
    invalid: boxes.filter((b) => !b.header && !IMPORTANCE_LEVELS.includes(b.importance)).map((b) => `${b.text}: ${b.importance}`),
  };
}
