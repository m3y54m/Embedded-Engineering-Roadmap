// Turns the roadmap README into a topic tree with descriptions, resources and cross-links.
// Pure module: no DOM access, so it runs in the browser and under `node --test`.

export const TYPES = {
  book: { icon: '📘', label: 'Book' },
  video: { icon: '🎞️', label: 'Video' },
  article: { icon: '📝', label: 'Article' },
  link: { icon: '🔗', label: 'Link' },
  audio: { icon: '🎧', label: 'Audio book' },
};

const TYPE_BY_SYMBOL = { '📘': 'book', '🎞': 'video', '📝': 'article', '🔗': 'link', '🎧': 'audio' };
// Heading prefixes the README uses only to mark the heading level.
const LEVEL_MARKERS = new Set(['✳', '🔵', '🔶', '🔸']);
const SYMBOLS = /^[\p{Extended_Pictographic}\uFE0F\u200D\u200C\u20E3\s]+/u;
const INVISIBLE = /[\uFE0F\u200D\u200C\u20E3\s]/u;
const URL_PART = String.raw`https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*`;
const HEADING = /^(#{1,6})\s+(.+)$/;
const RESOURCE = new RegExp(String.raw`^\s*[-*]\s+\[(.+)\]\((${URL_PART})\)(.*)$`, 'u');
const HEADING_LINK = new RegExp(String.raw`^\[(.+)\]\((${URL_PART})\)$`, 'u');
const BULLET = /^\s*[-*]\s+(.+)$/;
const SKIP = /^(\s*>|<!--|!\[|\[!\[|_{3,}\s*$|\|)/;

function splitSymbols(text) {
  const match = text.match(SYMBOLS);
  const prefix = match ? match[0] : '';
  return {
    prefix: prefix.trim(),
    symbols: [...prefix].filter((c) => !INVISIBLE.test(c)),
    rest: text.slice(prefix.length).replace(/\s+/g, ' ').trim(),
  };
}

function headingInfo(text) {
  const link = text.match(HEADING_LINK);
  const { prefix, symbols, rest } = splitSymbols(link ? link[1] : text);
  const generic = symbols.every((s) => LEVEL_MARKERS.has(s));
  return { title: rest, icon: generic ? '' : prefix, link: link ? link[2] : null, label: link ? link[1] : null };
}

function makeResource(label, url, trailing = '') {
  const { symbols, rest } = splitSymbols(label);
  let type = 'link';
  for (const s of symbols) if (TYPE_BY_SYMBOL[s]) type = TYPE_BY_SYMBOL[s];
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    domain = '';
  }
  return {
    title: rest,
    url,
    domain,
    type,
    beginner: symbols.includes('👶'),
    gem: symbols.includes('💎'),
    note: trailing.replace(/^\s*[-–—:]\s*/, '').trim(),
    topic: null,
    sharedWith: [],
  };
}

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

function makeNode(fields) {
  return { title: '', icon: '', depth: 0, group: '', parent: null, children: [], resources: [], description: [], ...fields };
}

export function parseRoadmap(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const root = makeNode({ id: 'root', slug: '', title: 'Embedded Engineering Roadmap' });
  const groups = [];
  const stack = [];
  let target = root;
  let topic = null;
  let paragraph = [];

  const flush = () => {
    if (paragraph.length && target) target.description.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const level = heading[1].length;
      if (level === 1) continue;
      const info = headingInfo(heading[2].trim());
      if (level === 2) {
        const group = makeNode({ title: info.title, icon: info.icon, topics: [] });
        groups.push(group);
        stack.length = 0;
        target = group;
        topic = null;
        continue;
      }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : root;
      const group = groups[groups.length - 1];
      const node = makeNode({ title: info.title, icon: info.icon, depth: parent.depth + 1, group: group ? group.title : '', parent });
      if (info.link) node.resources.push(makeResource(info.label, info.link));
      parent.children.push(node);
      if (group && parent === root) group.topics.push(node);
      stack.push({ level, node });
      target = node;
      topic = node;
      continue;
    }

    const resource = line.match(RESOURCE);
    if (resource) {
      flush();
      if (topic) topic.resources.push(makeResource(resource[1], resource[2], resource[3]));
      continue;
    }

    if (SKIP.test(line)) {
      flush();
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      flush();
      if (!target) continue;
      const last = target.description[target.description.length - 1];
      if (last && last.type === 'ul') last.items.push(bullet[1].trim());
      else target.description.push({ type: 'ul', items: [bullet[1].trim()] });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }
    // Text before the first "##" heading after the badges is the README introduction.
    if (target === root && root.description.length >= 2) continue;
    paragraph.push(line.trim());
  }
  flush();

  const topics = [];
  const used = new Set(['']);
  const walk = (node, path) => {
    for (const child of node.children) {
      let slug = slugify(child.title) || 'topic';
      if (used.has(slug)) slug = `${slug}-${slugify(node.title)}`;
      for (let i = 2; used.has(slug); i += 1) slug = `${slugify(child.title)}-${i}`;
      used.add(slug);
      child.slug = slug;
      child.id = slug;
      child.path = path;
      for (const r of child.resources) r.topic = child;
      topics.push(child);
      walk(child, [...path, child.title]);
    }
  };
  walk(root, []);

  const total = (node) => {
    node.total = node.resources.length + node.children.reduce((sum, c) => sum + total(c), 0);
    return node.total;
  };
  total(root);

  const order = new Map(topics.map((t, i) => [t, i]));
  const linkMap = new Map();
  const linkFor = (a, b) => {
    const [source, target] = order.get(a) <= order.get(b) ? [a, b] : [b, a];
    const key = `${source.id}|${target.id}`;
    if (!linkMap.has(key)) linkMap.set(key, { source, target, shared: [], mentions: [] });
    return linkMap.get(key);
  };

  const byUrl = new Map();
  for (const node of topics) {
    for (const r of node.resources) {
      const key = normalizeUrl(r.url);
      if (!byUrl.has(key)) byUrl.set(key, []);
      byUrl.get(key).push(r);
    }
  }
  for (const list of byUrl.values()) {
    const owners = [...new Set(list.map((r) => r.topic))];
    if (owners.length < 2) continue;
    for (const r of list) r.sharedWith = owners.filter((o) => o !== r.topic);
    for (let i = 0; i < owners.length; i += 1) {
      for (let j = i + 1; j < owners.length; j += 1) linkFor(owners[i], owners[j]).shared.push(list[0].title);
    }
  }

  const matchers = topics.map((t) => ({ topic: t, patterns: aliases(t.title).map(aliasPattern) }));
  for (const from of topics) {
    const texts = [
      ...from.resources.map((r) => `${r.title} ${r.note}`),
      ...from.description.flatMap((b) => (b.type === 'p' ? [b.text] : b.items)),
    ];
    for (const { topic: to, patterns } of matchers) {
      if (to === from || isLineage(from, to)) continue;
      for (const text of texts) {
        if (patterns.some((p) => p.test(text))) linkFor(from, to).mentions.push({ topic: from, text: plainText(text) });
      }
    }
  }

  const links = [...linkMap.values()];
  for (const link of links) link.weight = link.shared.length * 2 + link.mentions.length;
  for (const t of topics) t.links = [];
  for (const link of links) {
    link.source.links.push(link);
    link.target.links.push(link);
  }

  return {
    root,
    topics,
    groups: groups.filter((g) => g.topics.length),
    links,
    bySlug: new Map(topics.map((t) => [t.slug, t])),
    stats: { topics: topics.length, resources: byUrl.size, links: links.length },
  };
}

// Topic names too generic to count as a reference when they appear in another topic's text.
const ALIAS_STOPLIST = new Set(['Electronics', 'Make', 'Projects', 'Testing', 'Logic', 'Sensors', 'Actuators', 'Search and Ask!']);

function aliases(title) {
  const found = new Set([title]);
  const base = title.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => {
    found.add(inner.trim());
    return ' ';
  }).trim();
  found.add(base);
  for (const part of base.split(' / ')) found.add(part.trim());
  return [...found].filter((a) => !ALIAS_STOPLIST.has(a) && (a.length >= 3 || /^[A-Z0-9]{2,}$/.test(a)));
}

function aliasPattern(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w+#-])${escaped}(?![\\w+#-])`, 'u');
}

function isLineage(a, b) {
  for (let n = a; n; n = n.parent) if (n === b) return true;
  for (let n = b; n; n = n.parent) if (n === a) return true;
  return false;
}

function plainText(markdown) {
  return markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`$]/g, '').replace(/\s+/g, ' ').trim();
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const GREEK = { Pi: 'Π', pi: 'π', lambda: 'λ' };

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function formatText(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>')
    .replace(/\$\$\\(\w+)\$\$/g, (m, name) => GREEK[name] || name);
}

// Renders README inline markdown to HTML. Input is escaped first; only http(s) links become anchors.
export function renderInline(markdown) {
  const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let html = '';
  let last = 0;
  for (const m of markdown.matchAll(link)) {
    html += formatText(escapeHtml(markdown.slice(last, m.index)));
    html += `<a href="${escapeHtml(m[2])}" target="_blank" rel="noopener noreferrer">${formatText(escapeHtml(m[1]))}</a>`;
    last = m.index + m[0].length;
  }
  return html + formatText(escapeHtml(markdown.slice(last)));
}
