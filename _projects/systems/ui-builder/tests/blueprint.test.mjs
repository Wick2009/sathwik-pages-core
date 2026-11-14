// "What are you making?": page kinds and the quick form built into a page (blueprint.js), and the
// capstone page file that page exports (export.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mergeRegistry, normalizeRegistry } from '../js/registry.js';
import { normalizePage, validatePage } from '../js/page-model.js';
import { blueprintPage, cleanAnswers, kindsOf, missingAnswers } from '../js/blueprint.js';
import { contentRenderers } from '../js/blocks-content.js';
import { SAMPLE_ANSWERS as ANSWERS, counterIds, loadRegistry, needsRuby, readYaml } from './helpers.mjs';

const blocksOf = (section) => section.cells.flatMap((cell) => cell.blocks);
const ctxOf = (registry) => ({ registry, mode: 'export', baseurl: '', pageOrigin: 'https://pages.example.com', renderers: contentRenderers });

test('the registry merges the school pack\'s page kinds and quick form', needsRuby, () => {
  const registry = loadRegistry();
  assert.deepEqual(kindsOf(registry).map((k) => k.key), ['capstone', 'natm', 'csp', 'sprint']);
  assert.deepEqual(registry.blueprint.fields.map((f) => f.id), ['project', 'team', 'client', 'mission', 'course', 'repo', 'board', 'site', 'people']);
});

test('a capstone blueprint is the capstone outline, filled, and a valid page', needsRuby, () => {
  const registry = loadRegistry();
  const raw = blueprintPage(registry, 'capstone', ANSWERS, { capabilities: { spring: true, flask: true } });
  const page = normalizePage(raw, registry, { ids: counterIds() });
  assert.deepEqual(page.page, { title: 'Pantry Pal', description: ANSWERS.mission, byline: 'Byte Bakers', image: '', width: 'contained', course: 'csp' });
  assert.equal(page.sections.length, registry.page_kinds[0].sections.length);
  const hero = page.sections[0].cells[0].blocks[0];
  assert.equal(hero.settings.badge, 'CSP · Capstone');
  assert.equal(page.sections[0].settings.style, 'tint');
  const kanban = page.sections.flatMap(blocksOf).find((b) => b.type === 'kanban');
  assert.equal(kanban.settings.url, ANSWERS.board);
  assert.deepEqual(validatePage(page, registry, {}).filter((issue) => issue.key !== 'required').map((i) => i.key), []);
});

test('a blueprint leaves out sections this site can\'t run and tidies the answers', needsRuby, () => {
  const registry = loadRegistry();
  const flask = blueprintPage(registry, 'natm', ANSWERS, { capabilities: { flask: true } });
  const spring = blueprintPage(registry, 'natm', ANSWERS, { capabilities: { flask: true, spring: true } });
  assert.equal(spring.sections.length - flask.sections.length, 1, 'visitor feedback needs Spring');
  assert.ok(!flask.sections.flatMap(blocksOf).some((b) => b.type === 'feedback'));
  const clean = cleanAnswers(registry, { project: '  X  ', course: 'nope', people: [{ name: ' A ' }, {}, 'junk'], extra: 1 });
  assert.equal(clean.project, 'X');
  assert.equal(clean.course, '');
  assert.deepEqual(clean.people, [{ name: 'A', role: '', github: '' }]);
  assert.equal(clean.extra, undefined);
  assert.deepEqual(missingAnswers(registry, clean), []);
  assert.deepEqual(missingAnswers(registry, cleanAnswers(registry, {})), ['project']);
  assert.throws(() => blueprintPage(registry, 'novel', {}), /unknown page kind/);
});

test('broken page kinds or a broken quick form fail loudly at startup', () => {
  const base = readYaml('ui_builder.yml');
  const good = { section_categories: [{ key: 'a', label: 'A' }], section_presets: [{ key: 'p', category: 'a', section: { type: 'stack' } }], page_kinds: [{ key: 'k', sections: ['p'] }] };
  assert.doesNotThrow(() => normalizeRegistry(mergeRegistry(base, good)));
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, page_kinds: [{ key: 'k', sections: ['missing'] }] })), /unknown section preset missing/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, page_kinds: [...good.page_kinds, ...good.page_kinds] })), /page kind k is listed twice/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, page_kinds: [{ key: 'k' }] })), /needs a sections list/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, blueprint: { fields: [{ id: 'x', type: 'colour' }] } })), /unknown type colour/);
});

// The front matter as Ruby's YAML reads it (what Jekyll and the capstone catalog see).
const frontMatterOf = (file) => JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.safe_load(STDIN.read))'], { input: file.split('---\n')[1], encoding: 'utf8' }));

test('the capstone page file is a capstone post in its school-year folder, listed in the catalog by course', needsRuby, async () => {
  const { capstonePostPath, pageToCapstonePost, schoolYearOf } = await import('../js/export.js');
  const registry = loadRegistry();
  const page = normalizePage(blueprintPage(registry, 'capstone', { ...ANSWERS, project: 'Pantry Pal: "v2"' }, { capabilities: { flask: true } }), registry, { ids: counterIds() });
  const ctx = { ...ctxOf(registry), sanitizeRich: (html) => html, validators: { kanbanCanonicalUrl: (url) => url } };
  const file = pageToCapstonePost(page, ctx, new Date(2026, 10, 3));
  const [, front] = file.split('---\n');
  assert.equal(front, [
    'layout: post', 'title: "Pantry Pal: \\"v2\\""', 'description: "Families see what the pantry has today."', 'permalink: "/capstone/pantry-pal-v2/"',
    'capstone_project:', '  course: CSP', '  school_year: "2026-2027"', '  team: ["Ava", "leo-dev", "Mia"]',
    '  links:', '    repository: "https://github.com/example-team/pantry-pal"', 'microblog: true', 'toc: false', '',
  ].join('\n'));
  assert.deepEqual(frontMatterOf(file).capstone_project, {
    course: 'CSP', school_year: '2026-2027', team: ['Ava', 'leo-dev', 'Mia'], links: { repository: 'https://github.com/example-team/pantry-pal' },
  });
  assert.match(file, /\{% include ocs_kanban_board\.html url="https:\/\/github\.com\/orgs\/example-team\/projects\/1" %\}/);
  assert.match(file, /ocs__band ocs__band--tint/);
  assert.doesNotMatch(file, /\{project\}|\{people\}/);

  // The folder is the school year, which starts in August, as the capstone README says.
  assert.equal(capstonePostPath(page, ctx, new Date(2026, 10, 3)), '_posts/capstone/2026-2027/2026-11-03-pantry-pal-v2.md');
  assert.equal(capstonePostPath(page, { ...ctx, slug: 'pantry-pal' }, new Date(2027, 0, 9)), '_posts/capstone/2026-2027/2027-01-09-pantry-pal.md');
  assert.equal(schoolYearOf(new Date(2026, 6, 31)), '2025-2026');
  assert.equal(schoolYearOf(new Date(2026, 7, 1)), '2026-2027');
  assert.equal(schoolYearOf(new Date('nonsense')), '1969-1970');

  // A site link and a page picture become the card's demo link and image; hidden blocks don't count.
  const withSite = normalizePage(blueprintPage(registry, 'capstone', { ...ANSWERS, site: 'https://example-team.github.io/pantry-pal/' }, { capabilities: { flask: true } }), registry, { ids: counterIds() });
  withSite.page.image = '/images/capstone/pantry.png';
  for (const section of withSite.sections) for (const cell of section.cells) for (const block of cell.blocks) if (block.type === 'team') block.hidden = true;
  const listed = frontMatterOf(pageToCapstonePost(withSite, ctx, new Date(2026, 10, 3))).capstone_project;
  assert.deepEqual(listed, {
    course: 'CSP', school_year: '2026-2027', image: '/images/capstone/pantry.png',
    links: { repository: 'https://github.com/example-team/pantry-pal', demo: 'https://example-team.github.io/pantry-pal/' },
  });

  // An address another capstone page has is never reused: the school year, then a number, is added.
  const { capstoneFile } = await import('../js/export.js');
  const free = capstoneFile(page, ctx, new Date(2026, 10, 3));
  assert.equal(free.permalink, '/capstone/pantry-pal-v2/');
  assert.equal(free.taken, '');
  assert.equal(free.listed, true);
  const crowded = { ...ctx, registry: { ...registry, capstone_urls: ['/capstone/pantry-pal-v2/', '/capstone/pantry-pal-v2-2026/'] } };
  const renamed = capstoneFile(page, crowded, new Date(2026, 10, 3));
  assert.equal(renamed.permalink, '/capstone/pantry-pal-v2-2026-2/');
  assert.equal(renamed.taken, '/capstone/pantry-pal-v2/');
  assert.equal(renamed.path, '_posts/capstone/2026-2027/2026-11-03-pantry-pal-v2-2026-2.md');
  assert.equal(frontMatterOf(renamed.content).permalink, '/capstone/pantry-pal-v2-2026-2/');

  // Without a catalog course it is a supporting post: a top-level school_year, no capstone_project.
  const unlisted = normalizePage(blueprintPage(registry, 'capstone', { ...ANSWERS, course: '' }, { capabilities: { flask: true } }), registry, { ids: counterIds() });
  const supporting = frontMatterOf(pageToCapstonePost(unlisted, ctx, new Date(2027, 2, 1)));
  assert.equal(supporting.school_year, '2026-2027');
  assert.equal(supporting.capstone_project, undefined);

  // A Team section still holding its sample rows adds no names to the catalog card.
  const noPeople = normalizePage(blueprintPage(registry, 'capstone', { ...ANSWERS, people: [] }, { capabilities: { flask: true } }), registry, { ids: counterIds() });
  assert.equal(frontMatterOf(pageToCapstonePost(noPeople, ctx, new Date(2026, 10, 3))).capstone_project.team, undefined);
  assert.equal(capstoneFile(unlisted, ctx, new Date(2027, 2, 1)).listed, false);
});
