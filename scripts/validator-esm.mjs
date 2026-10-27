// Ajv's standalone ESM output still uses CommonJS for this runtime helper.
// Vite and Node both expose its CommonJS exports object as the default import.
export function browserEsm(source) {
  const helper = 'require("ajv/dist/runtime/ucs2length").default';
  const parts = source.split(helper);
  // Node exposes the CommonJS exports object; Vite's test runner may unwrap
  // its default export directly. Both forms must resolve to the same helper.
  const converted = parts.join('(typeof ucs2lengthModule === "function" ? ucs2lengthModule : ucs2lengthModule.default)');
  if (/\brequire\s*\(/.test(converted)) {
    throw new Error('Ajv emitted an unexpected require() in its standalone validator.');
  }
  const importStatement = parts.length > 1 ? "import ucs2lengthModule from 'ajv/dist/runtime/ucs2length.js';\n" : '';
  return `${importStatement}${converted.trimEnd()}\n`;
}
