// Interactive roadmap diagram: Software / Hardware / Soft skills areas with their cross-sections,
// importance colors, filters and connections between topics. Laid out by layout.js to fit A4.
import { AREAS, CREDITS, GITHUB_MARK, IMPORTANCE, areaDots, areaLabel, h, plural, svg } from './dom.js';
import { SPACE, buildLayout } from './layout.js';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 6;

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const hh = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && hh > 0 ? { x, y, w, h: hh } : null;
}

const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const rect = (r, attrs, parent) => svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, ...attrs }, parent);

function splitInTwo(text) {
  const words = text.split(' ');
  let best = [text];
  let score = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (Math.max(a.length, b.length) < score) {
      score = Math.max(a.length, b.length);
      best = [a, b];
    }
  }
  return best;
}

export function createMapView({ root, plan, data, build, onSelect }) {
  const layout = buildLayout(plan);
  const state = { selected: null, hover: null, areas: new Set(), importance: new Set(), showAll: false, view: null, drag: null };
  const boxEls = new Map();
  const rectOf = new Map();
  const legendParts = [];

  // ---------- toolbar ----------
  const chip = (label, cls, pressed, onclick, title) => h('button', {
    type: 'button', class: `map-chip ${cls}`, 'aria-pressed': String(pressed), onclick, title,
  }, label);
  const toolbar = h('div', { class: 'map-toolbar', role: 'toolbar', 'aria-label': 'Highlight topics' });
  const summary = h('span', { class: 'map-summary', role: 'status' });

  function renderToolbar() {
    const cross = state.areas.size === 2 && state.areas.has('SOFTWARE') && state.areas.has('HARDWARE');
    toolbar.replaceChildren(...[
      h('span', { class: 'map-toolbar-label' }, 'Highlight'),
      Object.entries(AREAS).map(([area, info]) => chip(h('span', {}, h('i', { class: `dot ${info.cls}` }), info.label),
        '', state.areas.has(area) && !cross, () => {
          state.areas = state.areas.has(area) && !cross ? new Set() : new Set([area]);
          refresh();
        }, `Topics in ${info.label}`)),
      chip(h('span', {}, h('i', { class: 'dot both' }), 'Software ∩ Hardware'), 'cross', cross, () => {
        state.areas = cross ? new Set() : new Set(['SOFTWARE', 'HARDWARE']);
        refresh();
      }, 'Topics that belong to both Software and Hardware'),
      h('span', { class: 'map-toolbar-sep', 'aria-hidden': 'true' }),
      Object.entries(IMPORTANCE).map(([level, label]) => chip(h('span', {}, h('i', { class: `imp-swatch ${level}` }), label),
        '', state.importance.has(level), () => toggle(state.importance, level))),
      h('span', { class: 'map-toolbar-sep', 'aria-hidden': 'true' }),
      chip('Show all connections', 'links', state.showAll, () => { state.showAll = !state.showAll; refresh(); },
        'Lines between topics that share resources or mention each other'),
      state.areas.size || state.importance.size ? chip('Clear', 'clear', false, () => {
        state.areas.clear();
        state.importance.clear();
        refresh();
      }) : null,
      summary,
    ].flat().filter(Boolean));
  }

  function toggle(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
    refresh();
  }

  // README topics that the diagram does not cover.
  const extra = data.root.children.filter((t) => !t.areas.length);
  const strip = h('nav', { class: 'start-strip', 'aria-label': 'Getting started topics' },
    h('span', { class: 'map-toolbar-label' }, 'Start here'),
    extra.map((t) => h('button', { type: 'button', class: 'start-chip', onclick: () => onSelect(t) },
      t.icon ? h('span', { 'aria-hidden': 'true' }, t.icon) : null, t.title)));

  // ---------- svg ----------
  const chart = svg('svg', {
    class: 'diagram',
    role: 'group',
    'aria-label': 'Roadmap diagram. Tab moves between topics, Enter opens one.',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const defs = svg('defs', {}, chart);
  const hatch = svg('pattern', { id: 'cross-hatch', width: 10, height: 10, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svg('line', { x1: 0, y1: 0, x2: 0, y2: 10, class: 'hatch-a' }, hatch);
  svg('line', { x1: 5, y1: 0, x2: 5, y2: 10, class: 'hatch-b' }, hatch);

  const layers = {};
  for (const name of ['page', 'areas', 'overlap', 'outlines', 'groups', 'linksAll', 'links', 'boxes', 'labels']) {
    layers[name] = svg('g', { class: `layer-${name}` }, chart);
  }

  rect({ x: 0, y: 0, w: layout.width, h: layout.height }, { class: 'page-bg' }, layers.page);

  // Title and legend, so the diagram also stands on its own when printed.
  const title = svg('text', { x: 24, y: layout.titleY, class: 'page-title' }, layers.labels);
  title.textContent = 'Embedded Systems Engineering Roadmap';
  const legend = svg('g', { class: 'page-legend' }, layers.labels);
  const legendItems = [
    ...Object.entries(IMPORTANCE).map(([level, label]) => ({ kind: 'imp', cls: level, label })),
    { kind: 'area', cls: 'sw', label: 'Software' },
    { kind: 'area', cls: 'hw', label: 'Hardware' },
    { kind: 'hatch', cls: '', label: 'Software ∩ Hardware' },
    { kind: 'area', cls: 'ss', label: 'Soft skills' },
  ];
  for (const item of legendItems) {
    const y = layout.titleY + 22;
    const cls = item.kind === 'imp' ? `legend-imp ${item.cls}` : item.kind === 'area' ? `legend-area ${item.cls}` : 'legend-hatch';
    const key = rect({ x: 0, y, w: 22, h: 13 }, { rx: item.kind === 'imp' ? 3 : 4, class: cls }, legend);
    const t = svg('text', { x: 0, y: y + 11, class: 'legend-text' }, legend);
    t.textContent = item.label;
    legendParts.push({ key, t, label: item.label });
  }

  function layoutLegend() {
    let x = 26;
    for (const part of legendParts) {
      part.key.setAttribute('x', x);
      part.t.setAttribute('x', x + 28);
      x += 28 + ((part.t.getComputedTextLength && part.t.getComputedTextLength()) || part.label.length * 6.5) + 20;
    }
  }
  const note = svg('text', { x: 24, y: layout.titleY + 54, class: 'legend-note' }, layers.labels);
  note.textContent = 'Colors show the average importance of each skill for an embedded systems engineer.';

  // Areas and their cross-sections.
  const sw = layout.areas.SOFTWARE;
  const hw = layout.areas.HARDWARE;
  const ss = layout.areas['SOFT SKILLS'];
  rect(sw, { rx: 28, class: 'area-fill sw' }, layers.areas);
  rect(hw, { rx: 28, class: 'area-fill hw' }, layers.areas);
  rect(ss, { rx: 28, class: 'area-fill ss' }, layers.areas);
  rect(layout.cross, { class: 'overlap-fill' }, layers.overlap);
  rect(sw, { rx: 28, class: 'area-line sw' }, layers.outlines);
  rect(hw, { rx: 28, class: 'area-line hw' }, layers.outlines);
  rect(ss, { rx: 28, class: 'area-line ss' }, layers.outlines);

  // Band names run down the left margin; every band reads as one area or a cross-section.
  for (const band of layout.bands) {
    const cy = (band.y0 + band.y1) / 2;
    const t = svg('text', {
      x: 0, y: 0, class: `band-label ${band.cls}`, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      transform: `translate(${sw.x + 18} ${cy.toFixed(1)}) rotate(-90)`,
    }, layers.labels);
    t.textContent = band.label;
  }

  const tags = [];
  function tag(text, cls, r, topic = null) {
    const g = svg('g', { class: `tag ${cls}` }, layers.labels);
    const bg = svg('rect', { class: 'tag-bg', height: 22, rx: 11 }, g);
    const label = svg('text', { class: 'tag-text', 'dominant-baseline': 'central' }, g);
    label.textContent = text;
    const entry = { g, bg, label, text, r };
    tags.push(entry);
    if (topic) wireTarget(g, topic, null, `${text} group`);
    return entry;
  }

  // Group labels all sit on the top-left of their own border.
  for (const group of layout.groups) {
    rect(group.rect, { rx: 16, class: `group-line ${group.cls}` }, layers.groups);
    tag(group.name, `group-tag ${group.cls}`, group.rect, group.topics[0] || null);
  }

  function layoutTags() {
    for (const t of tags) {
      const width = (t.label.getComputedTextLength && t.label.getComputedTextLength()) || t.text.length * 7;
      const x = t.r.x + 22;
      const y = t.r.y - 11;
      t.bg.setAttribute('x', x.toFixed(1));
      t.bg.setAttribute('y', y.toFixed(1));
      t.bg.setAttribute('width', (width + 22).toFixed(1));
      t.label.setAttribute('x', (x + 11).toFixed(1));
      t.label.setAttribute('y', (y + 11).toFixed(1));
    }
  }

  // Credits: where the resources are, who maintains the roadmap, its license and revision.
  const { x: fx, y: fy, w: fw } = layout.footer;
  const fr = fx + fw;
  const credits = svg('g', { class: 'page-credits' }, layers.labels);
  const link = (href) => svg('a', { href, target: '_blank', rel: 'noopener noreferrer' }, credits);
  const icon = svg('svg', { x: fx, y: fy + 2, width: 16, height: 16, viewBox: '0 0 16 16' }, credits);
  svg('path', { d: GITHUB_MARK, class: 'credit-icon' }, icon);
  const repo = svg('text', { x: fx + 24, y: fy + 15, class: 'credit-main' }, link(`https://${CREDITS.repo}`));
  repo.textContent = `Learning resources for every topic: ${CREDITS.repo}`;
  const creditLine = (y, label, value) => {
    const t = svg('text', { x: fx, y, class: 'credit-text' }, credits);
    t.append(label);
    svg('tspan', { class: 'credit-strong' }, t).textContent = value;
  };
  creditLine(fy + 35, 'Creator & Maintainer: ', CREDITS.author);
  if (build) creditLine(fy + 53, 'Revision: ', `${build.version}  ·  Last update: ${build.date}`);
  const logoSize = 52;
  const badge = { w: 103, h: 36 };
  svg('image', { href: 'assets/logo.svg', x: fr - logoSize, y: fy, width: logoSize, height: logoSize }, credits);
  const badgeX = fr - logoSize - SPACE - badge.w;
  svg('image', { href: 'assets/cc-by-sa.svg', x: badgeX, y: fy + (logoSize - badge.h) / 2, width: badge.w, height: badge.h }, link(CREDITS.licenseUrl));
  const licenseText = svg('text', { x: badgeX - 14, y: fy + 22, 'text-anchor': 'end', class: 'credit-text' }, link(CREDITS.licenseUrl));
  licenseText.textContent = 'This work is licensed under the Creative Commons';
  const licenseText2 = svg('text', { x: badgeX - 14, y: fy + 40, 'text-anchor': 'end', class: 'credit-text' }, link(CREDITS.licenseUrl));
  licenseText2.textContent = 'Attribution-ShareAlike 4.0 International License.';

  // ---------- topics ----------
  for (const item of layout.items) {
    const box = item.box;
    if (item.kind === 'caption') {
      const t = svg('text', { x: item.x, y: item.y + 15, class: 'cluster-caption' }, layers.boxes);
      t.textContent = item.text.toUpperCase();
      continue;
    }
    const topic = box.topics[0] || null;
    const g = svg('g', { class: `box ${item.kind === 'header' ? 'header' : box.importance}`, 'data-box': box.id }, layers.boxes);
    rectOf.set(box, item);
    if (item.kind === 'header') {
      const t = svg('text', { x: item.x, y: item.y + 16, class: 'box-text header-text' }, g);
      t.textContent = item.text;
      boxEls.set(box, { g, text: t, width: item.w, header: true });
    } else {
      rect(item, { rx: 5, class: 'box-bg' }, g);
      const lines = item.h >= 36 ? splitInTwo(item.text) : [item.text];
      const t = svg('text', { x: item.x + item.w / 2, y: item.y + item.h / 2, 'text-anchor': 'middle', class: 'box-text' }, g);
      lines.forEach((line, i) => {
        const span = svg('tspan', { x: item.x + item.w / 2, dy: i === 0 ? `${0.36 - (lines.length - 1) * 0.55}em` : '1.1em' }, t);
        span.textContent = line;
      });
      boxEls.set(box, { g, text: t, width: item.w - 10 });
    }
    for (const t of box.topics) {
      if (!t.layoutBoxes) t.layoutBoxes = [];
      t.layoutBoxes.push(box);
    }
    if (topic) wireTarget(g, topic, box);
  }

  function describe(topic, box) {
    const parts = [box ? box.text : topic.title];
    if (topic.areas.length) parts.push(areaLabel(topic.areas));
    const importance = (box && box.importance) || topic.importance;
    if (importance) parts.push(IMPORTANCE[importance]);
    parts.push(plural(topic.total, 'resource'));
    return parts.join(', ');
  }

  function wireTarget(el, topic, box = null, label = null) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', label ? `${label}, ${plural(topic.total, 'resource')}` : describe(topic, box));
    el.classList.add('target');
    el.addEventListener('pointerenter', (e) => hover(topic, box, e));
    el.addEventListener('pointermove', moveTip);
    el.addEventListener('pointerleave', () => hover(null));
    el.addEventListener('focus', () => hover(topic, box));
    el.addEventListener('blur', () => hover(null));
    el.addEventListener('click', () => {
      if (state.drag && state.drag.moved) return;
      onSelect(topic);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(topic);
      }
    });
  }

  // ---------- tooltip ----------
  const tip = h('div', { class: 'tooltip', hidden: true });
  function hover(topic, box = null, e = null) {
    state.hover = topic;
    drawLinks();
    if (!topic || !e) {
      tip.hidden = true;
      return;
    }
    const importance = (box && box.importance) || topic.importance;
    tip.replaceChildren(...[
      h('strong', {}, topic.title),
      topic.areas.length ? h('div', { class: 'tip-areas' }, areaDots(topic.areas), areaLabel(topic.areas)) : null,
      h('div', { class: 'tip-meta' }, [importance ? IMPORTANCE[importance] : null, plural(topic.total, 'resource'),
        box && box.related.length ? `${box.related.length} related` : null].filter(Boolean).join(' · ')),
      h('div', { class: 'tip-hint' }, 'Click this topic to open its details'),
    ].filter(Boolean));
    tip.hidden = false;
    moveTip(e);
  }

  function moveTip(e) {
    if (tip.hidden) return;
    const bounds = root.getBoundingClientRect();
    let x = e.clientX - bounds.left + 16;
    let y = e.clientY - bounds.top + 16;
    if (x + tip.offsetWidth > bounds.width - 8) x = e.clientX - bounds.left - tip.offsetWidth - 16;
    if (y + tip.offsetHeight > bounds.height - 8) y = e.clientY - bounds.top - tip.offsetHeight - 16;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }

  // ---------- connections ----------
  const connections = plan.connections.filter((c) => rectOf.has(c.a) && rectOf.has(c.b));

  function curve(a, b) {
    const [x1, y1] = center(rectOf.get(a));
    const [x2, y2] = center(rectOf.get(b));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const bend = 0.2;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${(mx - (y2 - y1) * bend).toFixed(1)} ${(my + (x2 - x1) * bend).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  function drawConnection(connection, layer, cls) {
    svg('path', {
      d: curve(connection.a, connection.b),
      class: `${cls} ${connection.reason ? 'curated' : 'evidence'}`,
      'stroke-width': connection.reason ? 2.4 : 1.4,
    }, layer);
    if (cls !== 'link') return;
    for (const box of [connection.a, connection.b]) {
      const [cx, cy] = center(rectOf.get(box));
      svg('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: 3, class: 'link-end' }, layer);
    }
  }

  // The overview of all connections only shows the hand-picked ones.
  for (const connection of connections) if (connection.reason) drawConnection(connection, layers.linksAll, 'link-all');

  const isWithin = (node, topic) => {
    for (let n = node; n; n = n.parent) if (n === topic) return true;
    return false;
  };

  function drawLinks() {
    layers.links.replaceChildren();
    const topic = state.hover || state.selected;
    const lit = new Set();
    if (topic) {
      const own = new Set(plan.boxes.filter((b) => rectOf.has(b) && b.topics.some((t) => isWithin(t, topic))));
      const fallback = plan.boxFor(topic);
      if (fallback && rectOf.has(fallback)) own.add(fallback);
      for (const b of own) lit.add(b);
      for (const connection of connections) {
        if (!(own.has(connection.a) || own.has(connection.b))) continue;
        if (!connection.reason && !connection.links.some((l) => isWithin(l.source, topic) || isWithin(l.target, topic))) continue;
        drawConnection(connection, layers.links, 'link');
        lit.add(connection.a);
        lit.add(connection.b);
      }
    }
    chart.classList.toggle('has-focus', Boolean(state.hover));
    for (const [box, el] of boxEls) {
      el.g.classList.toggle('lit', lit.has(box));
      el.g.classList.toggle('selected', Boolean(state.selected) && box.topics.includes(state.selected));
    }
  }

  // ---------- filters ----------
  function matches(box) {
    if (!rectOf.has(box) || boxEls.get(box).header) return false;
    for (const area of state.areas) if (!box.areas.includes(area)) return false;
    if (state.areas.size === 1 && box.areas.filter((a) => a !== 'SOFT SKILLS').length > 1 && !state.areas.has('SOFT SKILLS')) {
      // A single area means "only this area", so the cross-section stands apart.
      return false;
    }
    return !state.importance.size || state.importance.has(box.importance);
  }

  function refresh() {
    const filtering = state.areas.size > 0 || state.importance.size > 0;
    chart.classList.toggle('filtering', filtering);
    chart.classList.toggle('show-all', state.showAll);
    let count = 0;
    for (const [box, el] of boxEls) {
      const match = filtering && matches(box);
      if (match) count += 1;
      el.g.classList.toggle('match', match);
    }
    summary.textContent = filtering ? `${plural(count, 'topic')}` : '';
    renderToolbar();
  }

  // ---------- pan and zoom ----------
  const page = { w: layout.width, h: layout.height };
  const MAX_SCALE = 1.5;
  let fitMode = 'width';

  function canvasSize() {
    const box = chart.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? { w: box.width, h: box.height } : null;
  }

  // The view always has the canvas' aspect ratio, so the drawing fills it without letterboxing.
  function setView(view) {
    const size = canvasSize();
    const v = { ...view };
    v.h = size ? v.w * (size.h / size.w) : v.h || v.w * (page.h / page.w);
    const slackX = Math.max(0, page.w - v.w);
    const slackY = Math.max(0, page.h - v.h);
    v.x = slackX ? Math.min(Math.max(v.x, -40), slackX + 40) : (page.w - v.w) / 2;
    v.y = slackY ? Math.min(Math.max(v.y, -40), slackY + 40) : (page.h - v.h) / 2;
    state.view = v;
    chart.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
    if (size) zoomLevel.textContent = `${Math.round((size.w / v.w) * 100)}%`;
  }

  function fitWidth() {
    const size = canvasSize();
    const width = size ? Math.max(page.w + 40, size.w / MAX_SCALE) : page.w;
    fitMode = 'width';
    setView({ x: (page.w - width) / 2, y: -20, w: width });
    fitButton.title = 'Show the whole page';
  }

  const pageFitWidth = (size) => Math.max(page.w, (page.h + 40) / (size ? size.h / size.w : page.h / page.w)) + 40;

  function fitPage() {
    const size = canvasSize();
    const width = pageFitWidth(size);
    fitMode = 'page';
    setView({ x: (page.w - width) / 2, y: 0, w: width });
    fitButton.title = 'Fit the width';
  }

  const toggleFit = () => (fitMode === 'width' ? fitPage() : fitWidth());

  function toChart(clientX, clientY) {
    const matrix = chart.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [p.x, p.y];
  }

  function zoomAt(factor, clientX, clientY) {
    const v = state.view;
    const size = canvasSize();
    if (!size) return;
    const scale = (size.w / v.w) * factor;
    // Limits only stop a step that goes further out of range; the whole-page view is always reachable.
    const minScale = Math.min((size.w / page.w) * MIN_ZOOM, size.w / pageFitWidth(size), size.w / v.w);
    if (factor > 1 ? scale > MAX_ZOOM : scale < minScale) return;
    const [px, py] = clientX == null ? [v.x + v.w / 2, v.y + v.h / 2] : toChart(clientX, clientY);
    fitMode = 'custom';
    setView({ x: px - (px - v.x) / factor, y: py - (py - v.y) / factor, w: v.w / factor });
  }

  chart.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      return;
    }
    const size = canvasSize();
    if (!size) return;
    const unit = state.view.w / size.w;
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    setView({ ...state.view, x: state.view.x + dx * unit, y: state.view.y + dy * unit });
  }, { passive: false });
  chart.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    state.drag = { x: e.clientX, y: e.clientY, view: { ...state.view }, moved: false, id: e.pointerId };
  });
  chart.addEventListener('pointermove', (e) => {
    const drag = state.drag;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      chart.setPointerCapture(e.pointerId);
      chart.classList.add('panning');
    }
    const scale = drag.view.w / chart.getBoundingClientRect().width;
    fitMode = 'custom';
    setView({ ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale });
  });
  const endDrag = (e) => {
    if (!state.drag || state.drag.id !== e.pointerId) return;
    chart.classList.remove('panning');
    // The click that follows a drag still needs to see `moved`.
    window.setTimeout(() => { state.drag = null; }, 0);
  };
  chart.addEventListener('pointerup', endDrag);
  chart.addEventListener('pointercancel', endDrag);
  chart.addEventListener('dblclick', toggleFit);

  const zoomLevel = h('span', { class: 'zoom-level', 'aria-live': 'polite' }, '100%');
  const fitButton = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Toggle between fitting the width and the whole page', title: 'Show the whole page', onclick: toggleFit }, '⤢');
  const zoomControls = h('div', { class: 'zoom-controls' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom in', title: 'Zoom in (Ctrl + scroll)', onclick: () => zoomAt(1.25) }, '+'),
    zoomLevel,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom out', title: 'Zoom out (Ctrl + scroll)', onclick: () => zoomAt(1 / 1.25) }, '−'),
    fitButton);

  root.replaceChildren(
    h('div', { class: 'map-top' }, strip, toolbar),
    h('div', { class: 'map-canvas' }, chart, zoomControls),
    tip,
  );
  fitWidth();
  refresh();
  layoutLegend();
  layoutTags();
  // Tag and legend widths depend on the web font, so measure again once it has loaded.
  document.fonts.load('800 14px "Sofia Sans Semi Condensed"').then(() => requestAnimationFrame(relayout), () => {});

  // Keep the same part of the diagram in view when the window or panel changes size.
  new ResizeObserver(() => {
    if (!canvasSize() || state.beforePrint) return;
    if (fitMode === 'width') fitWidth();
    else if (fitMode === 'page') fitPage();
    else setView(state.view);
  }).observe(chart);

  // Long labels are squeezed to fit their box once real text widths are known.
  function fitText() {
    for (const [, el] of boxEls) {
      const spans = el.header ? [el.text] : [...el.text.querySelectorAll('tspan')];
      for (const span of spans) {
        span.removeAttribute('textLength');
        span.removeAttribute('lengthAdjust');
        if (span.getComputedTextLength() > el.width) {
          span.setAttribute('textLength', el.width.toFixed(1));
          span.setAttribute('lengthAdjust', 'spacingAndGlyphs');
        }
      }
    }
  }

  function relayout() {
    layoutLegend();
    layoutTags();
    fitText();
  }

  return {
    select(topic) {
      state.selected = topic;
      drawLinks();
    },
    show() {
      if (fitMode === 'width') fitWidth();
      relayout();
    },
    prepareForPrint() {
      state.hover = null;
      tip.hidden = true;
      state.beforePrint = { view: { ...state.view }, fitMode };
      state.view = { x: 0, y: 0, w: page.w, h: page.h };
      chart.setAttribute('viewBox', `0 0 ${page.w} ${page.h}`);
      relayout();
      drawLinks();
    },
    afterPrint() {
      if (!state.beforePrint) return;
      fitMode = state.beforePrint.fitMode;
      setView(state.beforePrint.view);
      state.beforePrint = null;
    },
    layout,
  };
}
