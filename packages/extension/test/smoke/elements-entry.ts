// Bundled the same way as the extension (see scripts/build.mjs) and run with plain Node to prove the
// parser and its native binding load from a CommonJS bundle.
import { readFileSync } from 'node:fs';
import { collectHostElements } from '@change-spotlight/vite-plugin/elements';

const file = process.argv[2]!;
const elements = collectHostElements(readFileSync(file, 'utf8'), { filename: file, relPath: 'playground/src/App.tsx', lang: 'tsx' });
console.log(JSON.stringify(elements));
