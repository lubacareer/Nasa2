import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserEsm } from './validator-esm.mjs';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const standaloneCode = require('ajv/dist/standalone').default;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'contracts', 'study-dataset.schema.json');
const outputPath = path.join(root, 'web', 'src', 'generated', 'study-dataset-validator.js');
const declarationPath = path.join(root, 'web', 'src', 'generated', 'study-dataset-validator.d.ts');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, code: { esm: true, source: true } });
const validate = ajv.compile(schema);
const generatedCode = browserEsm(standaloneCode(ajv, validate));
const declaration = [
  "import type { ValidateFunction } from 'ajv';",
  "import type { StudyDataset } from '../../../contracts/dataset';",
  'export declare const validate: ValidateFunction<StudyDataset>;',
  '',
].join('\n');

function updateOrCheck(filePath, expected) {
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    if (current !== expected) {
      console.error(`${path.relative(root, filePath)} is out of date; run npm run generate:validator.`);
      process.exitCode = 1;
    }
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, expected);
}

updateOrCheck(outputPath, generatedCode);
updateOrCheck(declarationPath, declaration);
