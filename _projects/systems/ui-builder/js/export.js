// Exports a page as JSON (the editor's Export JSON) and as an ordinary Jekyll page file (front
// matter + the page's ocs__ markup) that a student adds through the normal fork-and-PR flow, the
// inspectable artifact like GameBuilder's code. Everything author-typed is escaped: Jekyll runs
// Liquid over the whole file, so the only Liquid in it is include tags built from validated values.
//
// ctx: the render context (registry, baseurl, pageOrigin, renderers) plus sanitizeRich (from
// rich-content.js), validators.kanbanCanonicalUrl (the editor passes kanban-board.js
// parseBoardUrl(url)?.url), slug (the published slug, if any) and strict (tests).
import { defOf, liveTypes, textOf } from './registry.js';
import { renderBlock, renderPage, renderSection } from './render.js';
import { contentRenderers, lineOf, ownValue } from './blocks-content.js';
import { slugIssue, suggestSlug } from './url-rules.js';
import { answersFromPage } from './section-presets.js';
import { comment, h, liquid, toHTML } from './vnode.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/* ---------- JSON ---------- */

// Structural keys first, in reading order; everything else alphabetically. Same page, same file.
const KEY_ORDER = ['schemaVersion', 'kind', 'id', 'type', 'title', 'description', 'byline', 'course', 'width', 'image', 'page', 'settings', 'hidden', 'cells', 'blocks', 'sections'];
const rankOf = (key) => {
  const rank = KEY_ORDER.indexOf(key);
  return rank === -1 ? KEY_ORDER.length : rank;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  const keys = Object.keys(value).sort((a, b) => rankOf(a) - rankOf(b) || (a < b ? -1 : a > b ? 1 : 0));
  // A null-prototype copy keeps a "__proto__" key as plain data.
  const out = Object.create(null);
  for (const key of keys) out[key] = canonical(value[key]);
  return out;
}

export function pageToJSON(page) {
  return `${JSON.stringify(canonical(page), null, 2)}\n`;
}

/* ---------- front matter ---------- */

const char = (code) => String.fromCharCode(code);
// Controls (C0 with tab and newline, DEL, C1 with NEL), the line and paragraph separators, BOM and
// the two noncharacters: YAML ends a line at some of them and libyaml refuses the others, so one
// stray character could otherwise start a new front matter key or break the build.
const NOT_FOR_YAML = new RegExp(`[${char(0)}-${char(0x1f)}${char(0x7f)}-${char(0x9f)}${char(0x2028)}${char(0x2029)}${char(0xfeff)}${char(0xfffe)}${char(0xffff)}]`, 'g');

// Lone surrogates can't be written as UTF-8, so they are dropped too.
function wellFormed(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(index, index + 2);
        index += 1;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      out += text[index];
    }
  }
  return out;
}

export function frontMatterText(value) {
  return wellFormed(typeof value === 'string' ? value : '').replace(NOT_FOR_YAML, ' ').replace(/ {2,}/g, ' ').trim();
}

// A JSON string is a valid YAML double-quoted scalar: ": # [ {" stay inside the quotes.
function yamlValue(value) {
  return JSON.stringify(frontMatterText(value));
}

/* ---------- live blocks in a page file ---------- */

// Canonical board addresses only: https://github.com/orgs/<org>/projects/<n> or <owner>/<repo>/issues.
const KANBAN_URL = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const KANBAN_FILTER = /^[A-Za-z0-9 _-]{0,40}$/;
const COURSE_CODE = /^[a-z0-9_-]{1,16}$/;

function liveNote(type, ctx) {
  const def = defOf(ctx.registry, 'block', type);
  return comment(textOf(ctx.registry, 'blocks.needs_live_viewer', { label: (def && def.label) || type }));
}

// Titles go next to the include as escaped text, never into its parameters.
function titleHeading(settings) {
  const title = lineOf(settings, 'title');
  return title ? h('h3', { class: 'ocs__section-title' }, title) : null;
}

function kanbanInclude(settings, ctx) {
  const canonicalUrl = ctx.validators && ctx.validators.kanbanCanonicalUrl;
  const url = typeof canonicalUrl === 'function' ? canonicalUrl(lineOf(settings, 'url')) : null;
  if (typeof url !== 'string' || !KANBAN_URL.test(url)) return liveNote('kanban', ctx);
  const params = [`url="${url}"`];
  const filter = lineOf(settings, 'filter');
  if (filter && KANBAN_FILTER.test(filter)) params.push(`filter="${filter}"`);
  return [titleHeading(settings), liquid(`{% include ocs_kanban_board.html ${params.join(' ')} %}`)];
}

function courseCodeOf(ctx, value) {
  const code = typeof value === 'string' ? value.trim() : '';
  const known = (ctx.registry.courses || []).some((course) => course && course.value === code);
  return known && COURSE_CODE.test(code) ? code : '';
}

// The block's course, else the page's, else every course ("all"), like the include's own default.
function calendarInclude(settings, ctx) {
  const course = courseCodeOf(ctx, ownValue(settings, 'course')) || courseCodeOf(ctx, ownValue(ctx.pageSettings, 'course')) || 'all';
  return [titleHeading(settings), liquid(`{% include ocs_calendar_card.html course="${course}" %}`)];
}

function exportRenderer(type) {
  if (type === 'kanban') return kanbanInclude;
  if (type === 'calendar') return calendarInclude;
  return (settings, ctx) => liveNote(type, ctx);
}

function exportContext(ctx) {
  if (!isObject(ctx) || !isObject(ctx.registry)) throw new Error('UI Builder export: ctx.registry is required');
  const renderers = { ...(isObject(ctx.renderers) ? ctx.renderers : contentRenderers) };
  for (const type of liveTypes(ctx.registry)) renderers[type] = exportRenderer(type);
  return { ...ctx, mode: 'export', renderers };
}

function serialize(vnode, ctx) {
  return toHTML(vnode, { sanitizeRich: ctx.sanitizeRich, strict: ctx.strict === true });
}

/* ---------- page file ---------- */

// The title and slug both page files use: the published slug, else one made from the title.
function fileFacts(page, c) {
  const settings = isObject(ownValue(page, 'page')) ? page.page : {};
  const title = frontMatterText(lineOf(settings, 'title')) || textOf(c.registry, 'blocks.untitled');
  const slug = typeof c.slug === 'string' && slugIssue(c.slug, c.registry) === null ? c.slug : suggestSlug(title);
  return { settings, title, slug };
}

// The page file: layout, title, description and a /student-pages/ permalink, then the page's
// markup. Hidden sections and blocks are left out.
export function pageToMarkdown(page, ctx) {
  const c = exportContext(ctx);
  const { settings, title, slug } = fileFacts(page, c);
  const note = frontMatterText(textOf(c.registry, 'editor.export_permalink_note'));
  const frontMatter = [
    '---',
    'layout: opencs',
    `title: ${yamlValue(title)}`,
    `description: ${yamlValue(lineOf(settings, 'description'))}`,
    `permalink: ${yamlValue(`/student-pages/${slug}/`)}${note ? ` # ${note}` : ''}`,
    '---',
  ];
  return `${frontMatter.join('\n')}\n${serialize(renderPage(page, c), c)}\n`;
}

// The capstone page file (Studio): where a capstone page lives in the repository, as the capstone
// system's README says: _posts/capstone/<school_year>/YYYY-MM-DD-<slug>.md, with the post layout,
// a /capstone/<slug>/ permalink, the page's microblog and no table of contents. A page with a
// course the Capstone catalog knows declares capstone_project (course, school year, team, links,
// picture), so /capstone/ lists it; any other page is a supporting post with a top-level
// school_year. Same markup and escaping as the page file; the kanban block is the site's
// ocs_kanban_board include.
const CATALOG_COURSES = new Set(['CSA', 'CSP', 'CSH', 'CSSE']);
// The catalog's link kinds take only http(s) addresses (capstone.rb links).
const HTTP_URL = /^https?:\/\/\S+$/i;
const TEAM_MAX = 12;

const validDate = (date) => (date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0));

// The school year a day falls in; a year starts in August (2026-08-01 is in "2026-2027").
export function schoolYearOf(date = new Date()) {
  const day = validDate(date);
  const start = day.getMonth() >= 7 ? day.getFullYear() : day.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

// The page's /capstone/ slug: its own, unless another capstone page already has that address
// (registry.capstone_urls, from the editor page), then with the school year's start added, then
// a number. Two posts with one permalink overwrite each other, so the file never reuses one.
function capstoneSlug(page, c, date) {
  const { slug } = fileFacts(page, c);
  const taken = new Set(Array.isArray(c.registry.capstone_urls) ? c.registry.capstone_urls : []);
  const free = (candidate) => !taken.has(`/capstone/${candidate}/`);
  if (free(slug)) return { slug, wanted: slug };
  const dated = `${slug}-${schoolYearOf(date).slice(0, 4)}`;
  let candidate = dated;
  for (let n = 2; !free(candidate); n += 1) candidate = `${dated}-${n}`;
  return { slug: candidate, wanted: slug };
}

// Whether the Capstone catalog (/capstone/) lists the file: the page's course is one it knows.
export function capstoneListed(page) {
  const settings = isObject(ownValue(page, 'page')) ? page.page : {};
  return CATALOG_COURSES.has(typeof settings.course === 'string' ? settings.course.trim().toUpperCase() : '');
}

export function capstonePostPath(page, ctx, date = new Date()) {
  const c = exportContext(ctx);
  const { slug } = capstoneSlug(page, c, validDate(date));
  const day = validDate(date);
  const ymd = [day.getFullYear(), day.getMonth() + 1, day.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-');
  return `_posts/capstone/${schoolYearOf(day)}/${ymd}-${slug}.md`;
}

// What the catalog card shows, read from the shown sections only (hidden ones aren't exported):
// the first Team block's names (not the sample rows a Team section starts with), the repository
// and site links, and the page's picture.
function catalogFacts(page, settings, registry) {
  const fallbacks = isObject(registry.blueprint) && isObject(registry.blueprint.fallbacks) ? registry.blueprint.fallbacks : {};
  const samples = new Set((Array.isArray(fallbacks.people) ? fallbacks.people : []).filter(isObject).map((person) => person.name));
  const blocks = (Array.isArray(page.sections) ? page.sections : []).filter((s) => isObject(s) && s.hidden !== true)
    .flatMap((s) => (Array.isArray(s.cells) ? s.cells : []).flatMap((cell) => (isObject(cell) && Array.isArray(cell.blocks) ? cell.blocks : [])))
    .filter((block) => isObject(block) && block.hidden !== true);
  const answers = answersFromPage({ page: settings, sections: [{ cells: [{ blocks }] }] });
  const team = answers.people.map((person) => frontMatterText(person.name)).filter((name) => name && !samples.has(name)).slice(0, TEAM_MAX);
  const links = [['repository', answers.repo], ['demo', answers.site]].filter(([, url]) => HTTP_URL.test(url));
  const image = frontMatterText(lineOf(settings, 'image'));
  return { team, links, image: /^(?:https?:\/\/|\/(?!\/))\S+$/i.test(image) ? image : '' };
}

export function pageToCapstonePost(page, ctx, date = new Date()) {
  const c = exportContext(ctx);
  const { settings, title } = fileFacts(page, c);
  const { slug } = capstoneSlug(page, c, validDate(date));
  const year = schoolYearOf(date);
  const course = typeof settings.course === 'string' ? settings.course.trim().toUpperCase() : '';
  let listing = [`school_year: ${yamlValue(year)}`];
  if (capstoneListed(page)) {
    const { team, links, image } = catalogFacts(page, settings, c.registry);
    listing = [
      'capstone_project:',
      `  course: ${course}`,
      `  school_year: ${yamlValue(year)}`,
      ...(image ? [`  image: ${yamlValue(image)}`] : []),
      ...(team.length ? [`  team: [${team.map(yamlValue).join(', ')}]`] : []),
      ...(links.length ? ['  links:', ...links.map(([kind, url]) => `    ${kind}: ${yamlValue(url)}`)] : []),
    ];
  }
  const frontMatter = [
    '---',
    'layout: post',
    `title: ${yamlValue(title)}`,
    `description: ${yamlValue(lineOf(settings, 'description'))}`,
    `permalink: ${yamlValue(`/capstone/${slug}/`)}`,
    ...listing,
    'microblog: true',
    'toc: false',
    '---',
  ];
  return `${frontMatter.join('\n')}\n${serialize(renderPage(page, c), c)}\n`;
}

// Everything the Export capstone page file dialog shows: where the file goes, its text, whether
// the catalog lists it, and the address it wanted when that one was already taken.
export function capstoneFile(page, ctx, date = new Date()) {
  const c = exportContext(ctx);
  const { slug, wanted } = capstoneSlug(page, c, validDate(date));
  return {
    path: capstonePostPath(page, ctx, date),
    content: pageToCapstonePost(page, ctx, date),
    listed: capstoneListed(page),
    taken: slug === wanted ? '' : `/capstone/${wanted}/`,
    permalink: `/capstone/${slug}/`,
  };
}

// One block's page-file markup, for the code view (shown even while the block is hidden).
export function blockHTML(block, ctx) {
  const c = exportContext(ctx);
  return serialize(renderBlock(isObject(block) ? { ...block, hidden: false } : block, c), c);
}

// A section's page-file markup with its blocks left out, for the code view: the section's own tag
// and, for columns, one div per column.
export function sectionHTML(section, ctx) {
  if (!isObject(section)) return '';
  const c = exportContext(ctx);
  const cells = (Array.isArray(section.cells) ? section.cells : []).map((cell) => ({ ...(isObject(cell) ? cell : {}), blocks: [] }));
  return serialize(renderSection({ ...section, hidden: false, cells }, c), c);
}
