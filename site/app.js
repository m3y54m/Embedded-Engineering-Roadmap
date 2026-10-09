import { parseRoadmap, renderInline, TYPES } from './parser.js';
import { linkDiagram } from './diagram.js';
import { createMapView } from './mapview.js';
import { CREDITS, IMPORTANCE, areaDots, areaLabel, h, plural } from './dom.js';

const SOURCES = [
  'README.md',
  '../README.md',
  'https://raw.githubusercontent.com/m3y54m/Embedded-Engineering-Roadmap/master/README.md',
];
const REPO_URL = 'https://github.com/m3y54m/Embedded-Engineering-Roadmap';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrowScreen = window.matchMedia('(max-width: 960px)');

const els = {
  diagram: document.getElementById('diagram'),
  outline: document.getElementById('outline'),
  panel: document.getElementById('panel'),
  status: document.getElementById('status'),
  search: document.getElementById('search'),
  results: document.getElementById('search-results'),
  theme: document.getElementById('theme'),
  tabs: [...document.querySelectorAll('[data-view]')],
};

const state = {
  data: null,
  selected: null,
  includeSub: null,
  filters: { types: new Set(), beginner: false, gem: false },
  results: [],
  active: -1,
};

// ---------- small helpers ----------

const normalize = (text) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function* descendants(node) {
  yield node;
  for (const child of node.children) yield* descendants(child);
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); preferences just won't persist.
  }
  return null;
}

// ---------- colors ----------

function assignHues(data) {
  const [first, ...rest] = data.groups;
  const start = rest.length ? first.topics : [];
  const learning = rest.length ? rest.flatMap((g) => g.topics) : data.root.children;
  start.forEach((t, i) => { t.hue = 168 + (start.length > 1 ? (i * 40) / (start.length - 1) : 0); });
  learning.forEach((t, i) => { t.hue = (214 + (i * 300) / Math.max(1, learning.length)) % 360; });
  data.root.children.forEach((top, index) => {
    top.index = index;
    for (const n of descendants(top)) n.top = top;
  });
}

function colorOf(node) {
  if (!node.top) return 'var(--accent)';
  const dark = document.documentElement.dataset.theme !== 'light';
  const step = Math.min(node.depth - 1, 3);
  const alt = node.top.index % 2;
  const light = dark ? [54, 44, 37, 32][step] + alt * 7 : [62, 73, 81, 87][step] - alt * 6;
  const sat = dark ? [70, 56, 46, 40][step] : [72, 64, 56, 50][step];
  return `hsl(${node.top.hue.toFixed(1)} ${sat}% ${light}%)`;
}

function swatch(node) {
  const el = h('span', { class: 'swatch', 'aria-hidden': 'true' });
  el.style.background = colorOf(node);
  return el;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return max < 4 ? '' : `${text.slice(0, max - 1).trimEnd()}…`;
}

// ---------- navigation ----------

function navigate(node, { push = true, resource = null, reveal = false } = {}) {
  if (state.selected !== node) state.includeSub = null;
  state.selected = node;
  if (resource) resetFilters(false);
  if (state.mapView) state.mapView.select(node === state.data.root ? null : node);
  renderPanel(node);
  syncOutline();
  if (resource) revealResource(resource);
  const root = state.data.root;
  document.title = node === root ? 'Embedded Engineering Roadmap · Explorer' : `${node.title} · Embedded Engineering Roadmap`;
  if (push) {
    const hash = node === root ? '#/' : `#/${node.slug}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }
  if (reveal && narrowScreen.matches) openSheet(true);
}

function routeFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  navigate((slug && state.data.bySlug.get(slug)) || state.data.root, { push: false });
}

// ---------- details panel ----------

function section(title, ...content) {
  return h('section', { class: 'panel-section' }, title ? h('h3', {}, title) : null, ...content);
}

function crumbs(node) {
  const chain = [];
  for (let n = node.parent; n; n = n.parent) chain.unshift(n);
  if (!chain.length) return null;
  const root = state.data.root;
  return h('nav', { class: 'crumbs', 'aria-label': 'Topic path' }, chain.flatMap((n, i) => [
    i ? h('span', { 'aria-hidden': 'true' }, '›') : null,
    h('button', { type: 'button', onclick: () => navigate(n) }, n === root ? 'Overview' : n.title),
  ]));
}

function description(blocks) {
  const wrap = h('div', { class: 'desc' });
  for (const block of blocks) {
    if (block.type === 'p') {
      const p = h('p');
      p.innerHTML = renderInline(block.text);
      wrap.append(p);
    } else {
      const ul = h('ul');
      for (const item of block.items) {
        const li = h('li');
        li.innerHTML = renderInline(item);
        ul.append(li);
      }
      wrap.append(ul);
    }
  }
  return wrap;
}

function topicChips(nodes) {
  return h('div', { class: 'chips' }, nodes.map((n) => h('button', {
    type: 'button',
    class: 'chip-btn',
    onclick: () => navigate(n, { reveal: true }),
  }, swatch(n), n.title, h('span', { class: 'n' }, n.total))));
}

function related(node) {
  const items = [...node.links]
    .sort((a, b) => b.weight - a.weight)
    .map((link) => {
      const other = link.source === node ? link.target : link.source;
      const reasons = [];
      if (link.shared.length) reasons.push(plural(link.shared.length, 'shared resource'));
      const outgoing = link.mentions.filter((m) => m.topic === node);
      const incoming = link.mentions.filter((m) => m.topic !== node);
      if (outgoing.length) reasons.push(`mentioned here: “${truncate(outgoing[0].text, 60)}”`);
      else if (incoming.length) reasons.push(`mentions this topic: “${truncate(incoming[0].text, 60)}”`);
      const title = [...link.shared.map((s) => `Shared: ${s}`), ...link.mentions.map((m) => `${m.topic.title}: ${m.text}`)].join('\n');
      return h('li', {}, h('button', { type: 'button', title, onclick: () => navigate(other, { reveal: true }) },
        swatch(other),
        h('span', {}, other.title),
        h('span', { class: 'why' }, reasons.join(' · '))));
    });
  return h('ul', { class: 'related' }, items);
}

function passes(r) {
  const f = state.filters;
  return (!f.types.size || f.types.has(r.type)) && (!f.beginner || r.beginner) && (!f.gem || r.gem);
}

function resetFilters(rerender = true) {
  state.filters = { types: new Set(), beginner: false, gem: false };
  if (rerender) rerenderPanel();
}

function filterBar(entries) {
  const f = state.filters;
  const present = Object.keys(TYPES).filter((type) => entries.some((r) => r.type === type));
  const button = (label, pressed, onclick) => h('button', { type: 'button', class: 'filter', 'aria-pressed': String(pressed), onclick }, label);
  const active = f.types.size || f.beginner || f.gem;
  const hasBeginner = entries.some((r) => r.beginner);
  const hasGem = entries.some((r) => r.gem);
  if (present.length < 2 && !hasBeginner && !hasGem && !active) return null;
  return h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter resources' },
    present.length > 1 ? present.map((type) => button(`${TYPES[type].icon} ${TYPES[type].label}`, f.types.has(type), () => {
      if (f.types.has(type)) f.types.delete(type);
      else f.types.add(type);
      rerenderPanel();
    })) : null,
    hasBeginner ? button('👶 Beginner', f.beginner, () => { f.beginner = !f.beginner; rerenderPanel(); }) : null,
    hasGem ? button('💎 Essential', f.gem, () => { f.gem = !f.gem; rerenderPanel(); }) : null,
    active ? h('button', { type: 'button', class: 'filter reset', onclick: () => resetFilters() }, 'Clear filters') : null);
}

function resourceItem(r) {
  const type = TYPES[r.type];
  return h('li', { class: 'res', 'data-url': r.url },
    h('span', { class: 'res-icon', title: type.label, 'aria-label': type.label, role: 'img' }, type.icon),
    h('div', { class: 'res-body' },
      h('a', { class: 'res-title', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title),
      h('div', { class: 'res-meta' },
        h('span', {}, r.domain),
        r.beginner ? h('span', { class: 'badge beginner' }, 'Beginner') : null,
        r.gem ? h('span', { class: 'badge gem' }, 'Essential') : null),
      r.note ? h('p', { class: 'res-note' }, r.note) : null,
      r.sharedWith.length ? h('div', { class: 'res-also' }, 'Also listed in ', r.sharedWith.flatMap((t, i) => [
        i ? ', ' : null,
        h('button', { type: 'button', class: 'link-btn', onclick: () => navigate(t, { reveal: true }) }, t.title),
      ])) : null));
}

function resources(node) {
  const hasSub = node.children.length > 0 && node.total > node.resources.length;
  const include = hasSub && (state.includeSub ?? node.resources.length === 0);
  const groups = include
    ? [...descendants(node)].filter((n) => n.resources.length).map((n) => ({ node: n, list: n.resources }))
    : [{ node, list: node.resources }];
  const all = groups.flatMap((g) => g.list);
  const shown = all.filter(passes).length;

  const sec = h('section', { class: 'panel-section' },
    h('div', { class: 'res-head' },
      h('h3', {}, 'Resources'),
      h('span', { class: 'count' }, shown === all.length ? plural(all.length, 'item') : `${shown} of ${all.length}`)));
  if (hasSub) {
    const box = h('input', { type: 'checkbox', checked: include });
    box.addEventListener('change', () => {
      state.includeSub = box.checked;
      rerenderPanel();
    });
    sec.append(h('label', { class: 'toggle' }, box, `Include subtopics (${plural(node.total, 'resource')})`));
  }
  if (!all.length) {
    sec.append(h('p', { class: 'empty' }, 'This topic only groups its subtopics. Pick one above.'));
    return sec;
  }
  const filters = filterBar(all);
  if (filters) sec.append(filters);
  if (!shown) {
    sec.append(h('div', { class: 'empty' }, 'No resources match these filters. ',
      h('button', { type: 'button', class: 'link-btn', onclick: () => resetFilters() }, 'Clear filters')));
    return sec;
  }
  for (const group of groups) {
    const list = group.list.filter(passes);
    if (!list.length) continue;
    if (include) {
      sec.append(h('div', { class: 'res-group' },
        h('button', { type: 'button', onclick: () => navigate(group.node, { reveal: true }) }, group.node.title)));
    }
    sec.append(h('ul', { class: 'res-list' }, list.map(resourceItem)));
  }
  return sec;
}

function areaSummary() {
  const boxes = state.plan ? state.plan.boxes.filter((b) => !b.header) : [];
  const count = (test) => boxes.filter(test).length;
  const tile = (areas, n, label) => h('div', { class: 'stat' }, areaDots(areas), h('b', {}, n), h('span', {}, label));
  return h('div', { class: 'stats areas' },
    tile(['SOFTWARE'], count((b) => b.areas.length === 1 && b.areas[0] === 'SOFTWARE'), 'Software only'),
    tile(['SOFTWARE', 'HARDWARE'], count((b) => b.areas.includes('SOFTWARE') && b.areas.includes('HARDWARE') && !b.areas.includes('SOFT SKILLS')), 'Software ∩ Hardware'),
    tile(['HARDWARE'], count((b) => b.areas.length === 1 && b.areas[0] === 'HARDWARE'), 'Hardware only'));
}

function overview(root) {
  const { stats, groups } = state.data;
  return [
    section(null, description(root.description)),
    section(null, h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, stats.topics), h('span', {}, 'topics')),
      h('div', { class: 'stat' }, h('b', {}, stats.resources), h('span', {}, 'resources')),
      h('div', { class: 'stat' }, h('b', {}, stats.links), h('span', {}, 'connections')))),
    state.plan ? section('Diagram topics by area', areaSummary()) : null,
    ...groups.map((g) => section(g.title, topicChips(g.topics))),
    section('How to explore', h('ul', { class: 'howto' },
      h('li', {}, 'Map follows the roadmap diagram: topics sit in Software, Hardware or both, and are colored by importance.'),
      h('li', {}, 'Use the Areas chips to highlight a single area or only the Software ∩ Hardware cross-section.'),
      h('li', {}, 'Hover or select a topic to see lines to the topics it shares resources with (solid) or is mentioned by (dotted).'),
      h('li', {}, 'Outline lists every topic of the README; use it to browse topics that are not on the map.'),
      h('li', {}, 'Press ', h('kbd', {}, '/'), ' to search topics and resources.'))),
    section(null, h('p', { class: 'res-note' }, 'Built from the ',
      h('a', { href: `${REPO_URL}#readme`, target: '_blank', rel: 'noopener noreferrer' }, 'roadmap README'),
      ' and the map definition in the repository.')),
    section('Credits', credits()),
  ].filter(Boolean);
}

function credits() {
  const external = (href, ...children) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...children);
  const build = state.build;
  return h('div', { class: 'credits' },
    h('img', { class: 'credits-logo', src: 'assets/logo.svg', alt: '', width: 48, height: 48 }),
    h('div', { class: 'credits-body' },
      h('p', {}, 'Creator & maintainer: ', external(CREDITS.authorUrl, h('strong', {}, CREDITS.author))),
      build ? h('p', {}, 'Revision ', h('strong', {}, build.version), ` · last update ${build.date}`) : null,
      h('p', {}, 'Licensed under the ', external(CREDITS.licenseUrl, CREDITS.licenseName), '.'),
      external(CREDITS.licenseUrl, h('img', { class: 'credits-badge', src: 'assets/cc-by-sa.svg', alt: CREDITS.license, width: 88, height: 31 }))));
}

function renderPanel(node) {
  const root = state.data.root;
  const panel = els.panel;
  panel.replaceChildren();
  panel.append(h('header', { class: 'panel-head' },
    h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close details', onclick: () => openSheet(false) }, '✕'),
    crumbs(node),
    h('h2', { class: 'panel-title' },
      node.icon ? h('span', { class: 'title-icon', 'aria-hidden': 'true' }, node.icon) : node === root ? null : swatch(node),
      node === root ? 'Embedded Engineering Roadmap' : node.title),
    node === root ? null : h('div', { class: 'meta' },
      node.areas && node.areas.length ? h('span', { class: 'pill area-pill' }, areaDots(node.areas), areaLabel(node.areas)) : null,
      node.importance ? h('span', { class: `pill imp-pill ${node.importance}` }, IMPORTANCE[node.importance]) : null,
      h('span', { class: 'pill' }, plural(node.total, 'resource')),
      node.children.length ? h('span', { class: 'pill' }, plural(node.children.length, 'subtopic')) : null,
      node.links.length ? h('span', { class: 'pill' }, `${node.links.length} connected`) : null)));

  if (node === root) {
    panel.append(...overview(root));
    return;
  }
  if (node.description.length) panel.append(section('About', description(node.description)));
  if (node.children.length) panel.append(section('Subtopics', topicChips(node.children)));
  if (node.links.length) panel.append(section('Connected topics', related(node)));
  panel.append(resources(node));
}

function rerenderPanel() {
  const top = els.panel.scrollTop;
  renderPanel(state.selected);
  els.panel.scrollTop = top;
}

function revealResource(resource) {
  const item = [...els.panel.querySelectorAll('.res')].find((li) => li.dataset.url === resource.url);
  if (!item) return;
  item.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  item.classList.remove('flash');
  void item.offsetWidth;
  item.classList.add('flash');
}

function openSheet(open) {
  els.panel.classList.toggle('open', open);
  if (open) els.panel.focus({ preventScroll: true });
}

// ---------- outline view ----------

function buildOutline() {
  const { groups, stats } = state.data;
  const item = (node) => {
    const button = h('button', {
      type: 'button',
      class: 'tree-btn',
      'data-id': node.id,
      onclick: (e) => {
        e.preventDefault();
        navigate(node, { reveal: true });
      },
    }, swatch(node), h('span', { class: 'tree-title' }, node.title),
    node.areas && node.areas.length ? areaDots(node.areas) : null,
    h('span', { class: 'tree-count' }, node.total));
    if (!node.children.length) return h('li', {}, button);
    const details = h('details', {}, h('summary', {}, button), h('ul', { class: 'tree' }, node.children.map(item)));
    return h('li', {}, details);
  };
  els.outline.replaceChildren(
    h('h2', {}, 'All topics'),
    h('p', { class: 'res-note' }, `${stats.topics} topics and ${stats.resources} resources. Select a topic to see its details; use the arrows to expand.`),
    ...groups.map((g) => h('section', { class: 'outline-group' }, h('h3', {}, g.title), h('ul', { class: 'tree' }, g.topics.map(item)))),
  );
}

function syncOutline() {
  for (const btn of els.outline.querySelectorAll('.tree-btn[aria-current]')) btn.removeAttribute('aria-current');
  const btn = state.selected && els.outline.querySelector(`.tree-btn[data-id="${CSS.escape(state.selected.id)}"]`);
  if (!btn) return;
  btn.setAttribute('aria-current', 'true');
  for (let el = btn.parentElement; el && el !== els.outline; el = el.parentElement) {
    if (el.tagName === 'DETAILS') el.open = true;
  }
}

const VIEWS = ['map', 'list'];

function setView(view) {
  if (!VIEWS.includes(view) || (view === 'map' && !state.mapView)) view = state.mapView ? 'map' : 'list';
  els.diagram.hidden = view !== 'map';
  els.outline.hidden = view !== 'list';
  for (const tab of els.tabs) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
    if (tab.dataset.view === 'map') tab.hidden = !state.mapView;
  }
  store('roadmap-view', view);
  if (view === 'map') state.mapView.show();
  if (view === 'list') {
    syncOutline();
    const current = els.outline.querySelector('.tree-btn[aria-current]');
    if (current) current.scrollIntoView({ block: 'center' });
  }
}

// ---------- search ----------

function buildIndex() {
  state.index = {
    topics: state.data.topics.map((node) => ({
      node,
      title: normalize(node.title),
      text: normalize([node.title, ...node.path].join(' ')),
    })),
    resources: state.data.topics.flatMap((node) => node.resources.map((r) => ({
      node,
      r,
      text: normalize(`${r.title} ${r.domain}`),
    }))),
  };
}

function runSearch(query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const match = (entry) => tokens.every((t) => entry.text.includes(t));
  const topics = state.index.topics
    .filter(match)
    .map((e) => ({ ...e, score: e.title.startsWith(tokens[0]) ? 0 : e.title.includes(tokens[0]) ? 1 : 2 }))
    .sort((a, b) => a.score - b.score || a.node.depth - b.node.depth)
    .slice(0, 6)
    .map((e) => ({ kind: 'topic', node: e.node }));
  const seen = new Set();
  const resourceHits = state.index.resources
    .filter((e) => match(e) && !seen.has(e.r.url) && seen.add(e.r.url))
    .slice(0, 8)
    .map((e) => ({ kind: 'resource', node: e.node, r: e.r }));
  return [...topics, ...resourceHits];
}

function renderResults() {
  const box = els.results;
  const query = els.search.value.trim();
  box.replaceChildren();
  if (!query) {
    closeResults();
    return;
  }
  const results = state.results;
  if (!results.length) {
    box.append(h('div', { class: 'result-empty' }, `No topics or resources match “${query}”.`));
  }
  let lastKind = '';
  results.forEach((res, i) => {
    if (res.kind !== lastKind) {
      box.append(h('div', { class: 'result-group', role: 'presentation' }, res.kind === 'topic' ? 'Topics' : 'Resources'));
      lastKind = res.kind;
    }
    const isTopic = res.kind === 'topic';
    const option = h('div', {
      id: `result-${i}`,
      class: 'result',
      role: 'option',
      'aria-selected': String(i === state.active),
    },
    isTopic ? swatch(res.node) : h('span', { 'aria-hidden': 'true' }, TYPES[res.r.type].icon),
    h('div', { class: 'result-main' },
      h('div', { class: 'result-title' }, isTopic ? res.node.title : res.r.title, isTopic && res.node.areas && res.node.areas.length ? areaDots(res.node.areas) : null),
      h('div', { class: 'result-sub' }, isTopic
        ? (res.node.path.length ? res.node.path.join(' › ') : plural(res.node.total, 'resource'))
        : `${res.r.domain} · ${res.node.title}`)));
    option.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      choose(i);
    });
    box.append(option);
  });
  box.hidden = false;
  els.search.setAttribute('aria-expanded', 'true');
  els.search.setAttribute('aria-activedescendant', state.active >= 0 ? `result-${state.active}` : '');
}

function closeResults() {
  els.results.hidden = true;
  els.search.setAttribute('aria-expanded', 'false');
  els.search.removeAttribute('aria-activedescendant');
  state.active = -1;
}

function choose(index) {
  const res = state.results[index];
  if (!res) return;
  closeResults();
  els.search.value = '';
  els.search.blur();
  if (res.kind === 'topic') navigate(res.node, { reveal: true });
  else navigate(res.node, { resource: res.r, reveal: true });
}

function wireSearch() {
  els.search.addEventListener('input', () => {
    state.results = runSearch(els.search.value);
    state.active = state.results.length ? 0 : -1;
    renderResults();
  });
  els.search.addEventListener('keydown', (e) => {
    const count = state.results.length;
    if (e.key === 'ArrowDown' && count) {
      e.preventDefault();
      state.active = (state.active + 1) % count;
      renderResults();
      document.getElementById(`result-${state.active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp' && count) {
      e.preventDefault();
      state.active = (state.active - 1 + count) % count;
      renderResults();
      document.getElementById(`result-${state.active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(state.active >= 0 ? state.active : 0);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (els.search.value) {
        els.search.value = '';
        closeResults();
      } else {
        els.search.blur();
      }
    }
  });
  els.search.addEventListener('focus', () => {
    if (els.search.value.trim()) renderResults();
  });
  els.search.addEventListener('blur', () => window.setTimeout(closeResults, 120));
}

// ---------- theme, loading, startup ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (!state.data) return;
  buildOutline();
  syncOutline();
  rerenderPanel();
}

async function loadMarkdown() {
  for (const source of SOURCES) {
    try {
      const response = await fetch(source, { cache: 'no-cache' });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.includes('# Embedded Systems Engineering Roadmap')) return text;
    } catch {
      // Try the next source.
    }
  }
  throw new Error('README.md could not be loaded');
}

async function loadMap() {
  try {
    const response = await fetch('map.json', { cache: 'no-cache' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// Revision and date, written by CI next to the deployed site; absent in local previews.
async function loadBuild() {
  try {
    const response = await fetch('build.json', { cache: 'no-cache' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function isTyping(el) {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function wireGlobal() {
  els.theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    store('roadmap-theme', next);
    applyTheme(next);
  });
  for (const tab of els.tabs) tab.addEventListener('click', () => setView(tab.dataset.view));
  document.getElementById('print').addEventListener('click', () => window.print());
  // Printing always produces the diagram, whatever view is open.
  let viewBeforePrint = null;
  window.addEventListener('beforeprint', () => {
    if (!state.mapView) return;
    viewBeforePrint = store('roadmap-view');
    setView('map');
    state.mapView.prepareForPrint();
  });
  window.addEventListener('afterprint', () => {
    if (state.mapView) state.mapView.afterPrint();
    if (viewBeforePrint && viewBeforePrint !== 'map') setView(viewBeforePrint);
    viewBeforePrint = null;
  });
  window.addEventListener('popstate', () => routeFromHash());
  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      els.search.focus();
    } else if (e.key === 'Escape') {
      if (els.panel.classList.contains('open')) openSheet(false);
      else if (state.selected && state.selected.parent) navigate(state.selected.parent);
    }
  });
}

async function init() {
  applyTheme(store('roadmap-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  let markdown;
  const diagramRequest = loadMap();
  const buildRequest = loadBuild();
  try {
    markdown = await loadMarkdown();
  } catch {
    els.status.replaceChildren('The roadmap could not be loaded. ',
      h('a', { href: `${REPO_URL}#readme` }, 'Read it on GitHub instead'), '.');
    return;
  }
  state.data = parseRoadmap(markdown);
  assignHues(state.data);
  const diagram = await diagramRequest;
  state.build = await buildRequest;
  if (diagram) {
    state.plan = linkDiagram(diagram, state.data);
    state.mapView = createMapView({
      root: els.diagram,
      plan: state.plan,
      data: state.data,
      build: state.build,
      onSelect: (topic) => navigate(topic, { reveal: true }),
    });
  }
  buildOutline();
  buildIndex();
  wireSearch();
  wireGlobal();
  els.status.hidden = true;
  routeFromHash();
  setView(store('roadmap-view') || 'map');
}

init();
