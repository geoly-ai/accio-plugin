import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function readSkillFrontmatter(path) {
  const source = readFileSync(join(root, path), 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`Missing frontmatter in ${path}`);

  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!field) continue;
    values[field[1]] = field[2].replace(/^"|"$/g, '');
  }
  return values;
}

const plugin = readJson('plugin/plugin.json');
const i18n = readJson('plugin/resources/i18n.json');
const cli = readJson('plugin/clis/clis.json').tools.find(
  (tool) => tool.id === 'geoly',
);
const connector = readJson('plugin/connectors/connectors.json').oauth.geoly;
const display = readJson('plugin/skills/geoly-geo/display.txt');
const skill = readSkillFrontmatter('plugin/skills/geoly-geo/SKILL.md');

const sources = new Map([
  ['plugin.displayName', plugin.displayName],
  ['plugin.description', plugin.description],
  ['plugin.longDescription', plugin.longDescription],
  ['skill.geoly-geo.name', skill.displayName],
  ['skill.geoly-geo.description', skill.description],
  ['cli.geoly.name', cli?.displayName],
  ['cli.geoly.description', cli?.description],
  ['connector.geoly.name', connector.name],
  ['connector.geoly.brief', connector.brief],
  ['connector.geoly.description', connector.description],
]);

for (const item of display) {
  sources.set(`skill.geoly-geo.display.${item.id}.key`, item.key);
  sources.set(`skill.geoly-geo.display.${item.id}.value`, item.value);
}

const translationOnlyKeys = [
  'mcp.geoly.name',
  'mcp.geoly.brief',
  'mcp.geoly.description',
];
const requiredKeys = [...sources.keys(), ...translationOnlyKeys];
const requiredLocales = ['zh', 'zh-TW'];
const errors = [];

if (i18n.version !== '1.0') errors.push('i18n.version must be 1.0');
if (i18n.defaultLocale !== 'en') {
  errors.push('i18n.defaultLocale must be en');
}

for (const [key, value] of sources) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`Missing default English source: ${key}`);
  }
}

for (const key of requiredKeys) {
  for (const locale of requiredLocales) {
    const value = i18n.entries[key]?.[locale];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`Missing ${locale} translation: ${key}`);
    }
  }
}

for (const key of Object.keys(i18n.entries)) {
  if (/^(cli|mcp)\..+\.displayName$/.test(key)) {
    errors.push(`Use .name instead of .displayName: ${key}`);
  }
}

function resolve(key, locale) {
  const source = sources.get(key);
  if (locale === i18n.defaultLocale) return source;

  const candidates = [locale];
  const baseLocale = locale.split('-')[0];
  if (baseLocale !== locale) candidates.push(baseLocale);

  for (const candidate of candidates) {
    const value = i18n.entries[key]?.[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return source;
}

for (const key of sources.keys()) {
  if (resolve(key, 'en') !== sources.get(key)) {
    errors.push(`English must use the source value: ${key}`);
  }
  if (!resolve(key, 'zh') || !resolve(key, 'zh-TW')) {
    errors.push(`Chinese locale resolution failed: ${key}`);
  }
  if (resolve(key, 'es') !== sources.get(key)) {
    errors.push(`Spanish must fall back to English: ${key}`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(
  `i18n OK: ${sources.size} visible fields, ` +
    `${requiredLocales.join(' + ')} complete, en source and es fallback valid.`,
);
