// Print-friendly layout (A4 portrait proportions) for the roadmap map.
// Topics come from map.json; this file only decides where each cluster goes. Three horizontal bands
// make the areas explicit: Software only (top), Software ∩ Hardware (middle), Hardware only
// (bottom). Soft skills are not technical, so they get their own area below the others. The
// Real-Time OS cluster sits where the Operating Systems and Microcontrollers groups overlap.

// Minimum distance between any two boxes, texts or lines.
export const SPACE = 10;
const COL = 170;
const GUTTER = 26;
const LEFT = 86;
const TOP = 168;
const BOX_H = 26;
const BOX_H2 = 42;
const HEAD_H = 20;
const HEAD = HEAD_H + SPACE;
const GAP = 2 * SPACE;
const FOOTER_H = 56;
// Rough width of one character of box text, used to decide when a label wraps to two lines.
const CHAR_W = 6.3;
const TEXT_PAD = 8;

export const PAGE_WIDTH = LEFT * 2 + COL * 5 + GUTTER * 4;

const colX = (i) => LEFT + i * (COL + GUTTER);
const spanW = (n) => n * COL + (n - 1) * GUTTER;

// Cluster ids from map.json that this layout knows where to place.
export const PLACED = [
  'languages', 'fundamentals', 'debugging', 'sdlc', 'vcs', 'build', 'testing', 'specialized', 'osBase', 'linux',
  'rtos', 'mcu', 'bridge', 'basic', 'wireless', 'highSpeed', 'industrial', 'cellular', 'network', 'automotive',
  'display',
  'electronics', 'equipment', 'prototyping', 'fpga', 'soft',
];

function place(cluster, x, y, w) {
  const items = [];
  let cy = y;
  if (cluster.headerBox || cluster.caption) {
    items.push({
      kind: cluster.headerBox ? 'header' : 'caption',
      box: cluster.headerBox || null,
      text: cluster.headerBox ? cluster.headerBox.text : cluster.caption,
      x, y: cy, w, h: HEAD_H,
    });
    cy += HEAD;
  }
  const per = cluster.per || 1;
  const bw = (w - (per - 1) * SPACE) / per;
  for (let i = 0; i < cluster.boxes.length; i += per) {
    const row = cluster.boxes.slice(i, i + per);
    // Every box in a row gets the same height so the row stays aligned.
    const h = row.some((b) => b.text.length * CHAR_W + 2 * TEXT_PAD > bw && b.text.includes(' ')) ? BOX_H2 : BOX_H;
    row.forEach((box, j) => items.push({ kind: 'box', box, text: box.text, x: x + j * (bw + SPACE), y: cy, w: bw, h }));
    cy += h + SPACE;
  }
  return { items, bottom: cy - SPACE };
}

export function buildLayout(plan) {
  const clusters = {};
  for (const id of PLACED) {
    const spec = plan.clusters[id] || {};
    const own = plan.boxes.filter((b) => b.cluster === id);
    clusters[id] = { ...spec, headerBox: own.find((b) => b.header) || null, boxes: own.filter((b) => !b.header) };
  }
  // Topics in clusters this layout cannot place yet; the tests report them.
  const missing = plan.boxes.filter((b) => !PLACED.includes(b.cluster)).map((b) => `${b.cluster}: ${b.text}`);

  const items = [];
  const add = (result) => {
    items.push(...result.items);
    return result.bottom;
  };
  const stack = (ids, x, y, w) => ids.reduce((top, id, i) => add(place(clusters[id], x, i ? top + GAP : top, w)), y);
  const c = [0, 1, 2, 3, 4].map(colX);
  const wide = spanW(2);
  // Group tags are 22 high and centered on the group's top border.
  const TAG = 11;
  const belowTag = (y) => y + TAG + SPACE;

  // Software only.
  const languagesBottom = add(place(clusters.languages, c[0], TOP, COL));
  const fundamentalsBottom = add(place(clusters.fundamentals, c[1], TOP, COL));
  const col3 = stack(['debugging', 'sdlc', 'vcs'], c[2], TOP, COL);
  const col4 = stack(['build', 'testing'], c[3], TOP, COL);
  const col5 = add(place(clusters.specialized, c[4], TOP, COL));

  // OS outline is 2 spaces outside its content, Microcontrollers 1 space, and the Interfaces
  // outline keeps a full space from both inside the gutter between them.
  const leftW = wide + GUTTER - 4 * SPACE;
  const osTop = Math.max(languagesBottom, fundamentalsBottom) + GAP + TAG;
  let osY = add(place(clusters.osBase, c[0], belowTag(osTop), leftW));
  osY = add(place(clusters.linux, c[0], osY + GAP, leftW));

  // Software ∩ Hardware.
  const crossTop = Math.max(osY, col3, col4, col5) + GAP;
  const groupTop = crossTop + GAP;
  const rtosBottom = add(place(clusters.rtos, c[0], belowTag(groupTop), leftW));
  const os = { x: c[0] - 2 * SPACE, y: osTop, w: leftW + 4 * SPACE, h: rtosBottom + SPACE - osTop };
  const mcuBottom = add(place(clusters.mcu, c[0], os.y + os.h + SPACE, leftW));
  const mcu = { x: c[0] - SPACE, y: groupTop, w: leftW + 2 * SPACE, h: mcuBottom + SPACE - groupTop };

  const subW = (wide - 2 * SPACE) / 3;
  const sub = [0, 1, 2].map((i) => c[2] + i * (subW + SPACE));
  const ifContent = belowTag(groupTop);
  const ifBottom = Math.max(
    stack(['basic', 'wireless'], sub[0], ifContent, subW),
    stack(['highSpeed', 'industrial', 'cellular'], sub[1], ifContent, subW),
    stack(['network', 'automotive', 'display'], sub[2], ifContent, subW),
  );
  const interfaces = { x: c[2] - SPACE, y: groupTop, w: wide + 2 * SPACE, h: ifBottom + SPACE - groupTop };
  const bridgeBottom = add(place(clusters.bridge, c[4], groupTop, COL));
  const crossBottom = Math.max(mcu.y + mcu.h, interfaces.y + interfaces.h, bridgeBottom) + GAP;

  // Hardware only.
  const hwTop = crossBottom + GAP;
  const hwBottom = Math.max(
    add(place(clusters.electronics, c[0], hwTop, wide)),
    add(place(clusters.equipment, c[2], hwTop, COL)),
    add(place(clusters.prototyping, c[3], hwTop, COL)),
    add(place(clusters.fpga, c[4], hwTop + HEAD, COL)),
  );

  const areaX = 24;
  const areaW = PAGE_WIDTH - 2 * areaX;
  const swTop = TOP - 40;
  const hwEnd = hwBottom + GAP;

  // Soft skills: a separate area under the technical ones, tall enough for its margin label.
  const softTop = hwEnd + GAP;
  const softRows = Math.ceil(clusters.soft.boxes.length / clusters.soft.per);
  const softH = Math.max(132, softRows * (BOX_H2 + SPACE) - SPACE + 2 * GAP);
  const soft = { x: areaX, y: softTop, w: areaW, h: softH };
  const softContentH = place(clusters.soft, 0, 0, spanW(5)).bottom;
  add(place(clusters.soft, c[0], softTop + (softH - softContentH) / 2, spanW(5)));
  const softEnd = softTop + softH;

  const regionByName = new Map(plan.regions.map((r) => [r.name, r]));
  const groupTopics = (name) => (regionByName.get(name) || { topics: [] }).topics;
  const footer = { x: areaX, y: softEnd + GAP, w: areaW, h: FOOTER_H };

  return {
    width: PAGE_WIDTH,
    height: footer.y + footer.h + 16,
    titleY: 58,
    footer,
    areas: {
      SOFTWARE: { x: areaX, y: swTop, w: areaW, h: crossBottom - swTop },
      HARDWARE: { x: areaX, y: crossTop, w: areaW, h: hwEnd - crossTop },
      'SOFT SKILLS': soft,
    },
    cross: { x: areaX, y: crossTop, w: areaW, h: crossBottom - crossTop },
    bands: [
      { label: 'SOFTWARE', cls: 'sw', y0: swTop, y1: crossTop },
      { label: 'SOFTWARE ∩ HARDWARE', cls: 'both', y0: crossTop, y1: crossBottom },
      { label: 'HARDWARE', cls: 'hw', y0: crossBottom, y1: hwEnd },
      { label: 'SOFT SKILLS', cls: 'ss', y0: softTop, y1: softEnd },
    ],
    groups: [
      { name: 'Operating Systems', cls: 'g-os', rect: os, topics: groupTopics('Operating Systems') },
      { name: 'Microcontrollers', cls: 'g-mcu', rect: mcu, topics: groupTopics('Microcontrollers') },
      { name: 'Interfaces & Protocols', cls: 'g-ifc', rect: interfaces, topics: groupTopics('Interfaces & Protocols') },
    ],
    items,
    missing,
  };
}
