import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { browserEsm } from '../scripts/validator-esm.mjs';
import { validate } from '../web/src/generated/study-dataset-validator.js';

const fixture = JSON.parse(readFileSync(new URL('../web/public/data/preview.json', import.meta.url), 'utf8'));

test('generated validator accepts the fixture and Unicode, and rejects malformed and empty strings', () => {
  assert.equal(validate(fixture), true);
  assert.equal(validate({ ...fixture, id: '🌍' }), true);
  assert.equal(validate({ ...fixture, id: '' }), false);
  assert.equal(validate({ ...fixture, id: 42 }), false);
  assert.equal(validate({}), false);
});

test('generator rejects unexpected Ajv CommonJS references', () => {
  const helper = 'require("ajv/dist/runtime/ucs2length").default';
  assert.match(browserEsm(`const f = ${helper};`), /ucs2lengthModule\.default/);
  assert.equal(browserEsm('const f = 1;'), 'const f = 1;\n');
  const multiple = browserEsm(`const f = ${helper}; const g = ${helper};`);
  assert.equal((multiple.match(/ucs2lengthModule\.default/g) ?? []).length, 2);
  assert.equal((multiple.match(/import ucs2lengthModule/g) ?? []).length, 1);
  assert.throws(() => browserEsm('require("other");'), /unexpected require/);
  assert.throws(() => browserEsm(`${helper}; require("other");`), /unexpected require/);
});
