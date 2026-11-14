// The section library (Add section): the school pack's presets, filling their placeholders from
// the page's facts, the library's groups and reasons, and inserting whole sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegistry, normalizeRegistry } from '../js/registry.js';
import { insertSections, normalizePage, validatePage } from '../js/page-model.js';
import { fillSection, libraryOf, peopleItems, placeholderValues, presetReason, presetSection, sectionBlockTypes } from '../js/section-presets.js';
import { SAMPLE_ANSWERS as ANSWERS, counterIds, loadRegistry, needsRuby, readYaml } from './helpers.mjs';

const blocksOf = (section) => section.cells.flatMap((cell) => cell.blocks);

test('the registry merges the school pack\'s section categories, presets and fallbacks', needsRuby, () => {
  const registry = loadRegistry();
  assert.ok(registry.section_presets.length >= 20, 'presets');
  assert.deepEqual(registry.section_categories.map((c) => c.key), ['intro', 'client', 'problem', 'features', 'flow', 'plan', 'team', 'evidence', 'showcase', 'contact']);
  assert.equal(registry.blueprint.fallbacks.client, 'our client');
});

test('every preset is one section of known blocks that a page accepts once filled', needsRuby, () => {
  const registry = loadRegistry();
  for (const preset of registry.section_presets) {
    assert.ok(registry.frames[preset.section.type], `${preset.key}: frame`);
    for (const type of sectionBlockTypes(preset.section)) assert.ok(registry.blocks[type], `${preset.key}: block ${type}`);
    const raw = presetSection(registry, preset.key, ANSWERS);
    const { page } = insertSections(normalizePage({ page: { title: 'T' }, sections: [] }, registry, { ids: counterIds() }), registry, { sections: [raw], ids: counterIds() });
    assert.equal(page.sections.length, 1, preset.key);
    assert.equal(blocksOf(page.sections[0]).length, sectionBlockTypes(preset.section).length, `${preset.key}: no block dropped`);
    // No placeholder survives a fill, and nothing the fill wrote breaks the page's rules.
    assert.doesNotMatch(JSON.stringify(page), /\{(project|team|client|mission|course_label|kind_badge|repo|board|site|people)\}/, preset.key);
    const issues = validatePage(page, registry, {}).filter((issue) => !['required'].includes(issue.key));
    assert.deepEqual(issues.map((issue) => `${issue.field}:${issue.key}`), [], preset.key);
  }
});

test('the fill escapes rich text, keeps table answers in one cell and drops buttons for empty links', needsRuby, () => {
  const registry = loadRegistry();
  const client = presetSection(registry, 'client_story', ANSWERS);
  const [heading, text] = client.cells[0].blocks;
  assert.equal(heading.settings.text, 'The story of Harbor <Food> & Pantry', 'plain text stays plain');
  assert.match(text.settings.body, /Who Harbor &lt;Food&gt; &amp; Pantry serves/, 'rich text is escaped');
  const table = fillSection(registry, { type: 'stack', settings: {}, cells: [{ blocks: [{ type: 'table', settings: { data: 'A | B\n{project} | x' } }] }] }, { project: 'One | Two\nThree' });
  assert.equal(table.cells[0].blocks[0].settings.data, 'A | B\nOne / Two Three | x');
  const header = presetSection(registry, 'project_header', ANSWERS).cells[0].blocks[0].settings;
  assert.deepEqual(header.links, [{ label: 'Source code', url: ANSWERS.repo }, { label: 'Project board', url: ANSWERS.board }], 'Try it is gone: no site');
  assert.equal(header.badge, 'OCS · Project', 'fallbacks for a preset added without a kind');
  assert.equal(presetSection(registry, 'project_header', {}).cells[0].blocks[0].settings.title, 'Our project');
  assert.equal(presetSection(registry, 'nope', ANSWERS), null);
});

test('people become the Team block: names, roles and real GitHub profiles only', needsRuby, () => {
  const registry = loadRegistry();
  const field = registry.blocks.team.fields.find((f) => f.id === 'items');
  assert.deepEqual(peopleItems(field, ANSWERS.people), [
    { name: 'Ava', role: 'Scrum master', url: 'https://github.com/ava-codes' },
    { name: 'leo-dev', role: 'Backend', url: 'https://github.com/leo-dev' },
    { name: 'Mia', role: '', url: '' },
  ]);
  const team = presetSection(registry, 'team_roles', ANSWERS).cells[0].blocks[0];
  assert.equal(team.settings.items.length, 3);
  // No one listed (or only empty rows): sample rows to replace, never an empty Team section.
  const samples = [{ name: 'Your name', role: 'What you own', url: '' }, { name: 'Teammate', role: 'What they own', url: '' }];
  assert.deepEqual(presetSection(registry, 'team_roles', {}).cells[0].blocks[0].settings.items, samples);
  assert.deepEqual(presetSection(registry, 'team_roles', { people: [{ name: ' ', role: 'x', github: '' }] }).cells[0].blocks[0].settings.items, samples);
});

test('placeholder words come from answers, then fallbacks; links never get fallback words', needsRuby, () => {
  const registry = loadRegistry();
  const values = placeholderValues(registry, { project: '  ', site: '', client: 'X' });
  assert.equal(values.project, 'Our project');
  assert.equal(values.client, 'X');
  assert.equal(values.site, '');
  assert.equal(values.people, undefined);
});

test('the library lists Blank first, then categories, with Spring and live-limit reasons', needsRuby, () => {
  const registry = loadRegistry();
  const blank = [{ type: 'stack', label: 'One column' }];
  const flaskOnly = libraryOf(registry, { capabilities: { flask: true }, liveCount: 0, blankChoices: blank, blankLabel: 'Blank' });
  assert.equal(flaskOnly[0].category, 'blank');
  assert.equal(flaskOnly[0].items[0].kind, 'frame');
  const items = flaskOnly.flatMap((group) => group.items);
  assert.equal(items.find((item) => item.key === 'message_us').reasonKey, 'blocks.live_needs_spring');
  assert.equal(items.find((item) => item.key === 'project_board').disabled, false);
  const full = libraryOf(registry, { capabilities: { flask: true, spring: true }, liveCount: registry.limits.live_blocks });
  assert.equal(full.flatMap((group) => group.items).find((item) => item.key === 'project_board').reasonKey, 'errors.too_many_live');
  assert.equal(presetReason(registry, presetSection(registry, 'core_features'), { liveCount: 99 }), null, 'no live blocks, no limit');
});

test('insertSections adds sections where asked with fresh, free ids and never changes the input', needsRuby, () => {
  const registry = loadRegistry();
  const page = normalizePage({ page: { title: 'T' }, sections: [{ id: 's-000001', type: 'stack', cells: [{ blocks: [{ id: 'b-000002', type: 'divider' }] }] }] }, registry, { ids: counterIds() });
  const before = JSON.stringify(page);
  const raw = presetSection(registry, 'core_features', {});
  const { page: next, ids } = insertSections(page, registry, { sections: [raw, raw], index: 0, ids: counterIds() });
  assert.equal(JSON.stringify(page), before);
  assert.equal(next.sections.length, 3);
  assert.deepEqual(next.sections.slice(0, 2).map((s) => s.id), ids);
  const all = next.sections.flatMap((s) => [s.id, ...blocksOf(s).map((b) => b.id)]);
  assert.equal(new Set(all).size, all.length, 'no id repeats');
  assert.ok(!ids.includes('s-000001'));
  assert.equal(next.sections[2], page.sections[0], 'the old section is shared');
  assert.equal(insertSections(page, registry, { sections: [{ type: 'marquee' }], ids: counterIds() }).page, page);
  assert.throws(() => insertSections(page, registry, { sections: [raw] }), /ids\(kind\)/);
});

test('a broken section library fails loudly at startup', () => {
  const base = readYaml('ui_builder.yml');
  const good = { section_categories: [{ key: 'a', label: 'A' }], section_presets: [{ key: 'p', category: 'a', section: { type: 'stack' } }] };
  assert.doesNotThrow(() => normalizeRegistry(mergeRegistry(base, good)));
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, section_presets: [{ key: 'p', category: 'zz', section: { type: 'stack' } }] })), /unknown category zz/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, section_presets: [...good.section_presets, ...good.section_presets] })), /section preset p is listed twice/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, section_categories: [...good.section_categories, ...good.section_categories] })), /section category a is listed twice/);
  assert.throws(() => normalizeRegistry(mergeRegistry(base, { ...good, section_presets: [{ key: 'q', category: 'a' }] })), /needs a section with a type/);
});

test('a page\'s own facts fill sections added later', needsRuby, async () => {
  const { answersFromPage } = await import('../js/section-presets.js');
  const registry = loadRegistry();
  const filled = { ...ANSWERS, site: 'https://example-team.github.io/pantry-pal/' };
  const start = normalizePage({ page: { title: 'Pantry Pal', byline: 'Byte Bakers', description: ANSWERS.mission, course: 'csp' }, sections: [] }, registry, { ids: counterIds() });
  const sections = ['project_header', 'project_board', 'team_roles'].map((key) => presetSection(registry, key, filled));
  const { page } = insertSections(start, registry, { sections, ids: counterIds() });
  const answers = answersFromPage(page);
  assert.equal(answers.project, 'Pantry Pal');
  assert.equal(answers.team, 'Byte Bakers');
  assert.equal(answers.board, ANSWERS.board);
  assert.equal(answers.repo, ANSWERS.repo);
  assert.equal(answers.site, 'https://example-team.github.io/pantry-pal/');
  assert.deepEqual(answers.people.map((p) => p.github), ['ava-codes', 'leo-dev', '']);
  const links = presetSection(registry, 'project_links', answers).cells[0].blocks[1].settings.items.map((item) => item.url);
  assert.deepEqual(links, [ANSWERS.repo, ANSWERS.board, 'https://example-team.github.io/pantry-pal/']);
  assert.deepEqual(answersFromPage(null).people, []);
});
