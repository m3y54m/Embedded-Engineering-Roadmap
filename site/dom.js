// DOM helpers shared by the views.

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const CREDITS = {
  author: 'Meysam Parvizi',
  authorUrl: 'https://github.com/m3y54m',
  repo: 'github.com/m3y54m/Embedded-Engineering-Roadmap',
  license: 'CC BY-SA 4.0',
  licenseName: 'Creative Commons Attribution-ShareAlike 4.0 International License',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export const GITHUB_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function svg(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value != null) el.setAttribute(key, value);
  if (parent) parent.append(el);
  return el;
}

export const AREAS = {
  SOFTWARE: { label: 'Software', cls: 'sw' },
  HARDWARE: { label: 'Hardware', cls: 'hw' },
  'SOFT SKILLS': { label: 'Soft skills', cls: 'ss' },
};

export const IMPORTANCE = {
  required: 'Required',
  recommended: 'Recommended',
  possible: 'Possibility',
};

export const areaClass = (area) => (AREAS[area] ? AREAS[area].cls : 'xx');
export const areaLabel = (areas) => areas.map((a) => (AREAS[a] ? AREAS[a].label : a)).join(' ∩ ');

export function areaDots(areas) {
  return h('span', { class: 'area-dots', 'aria-hidden': 'true' }, areas.map((a) => h('i', { class: `dot ${areaClass(a)}` })));
}
