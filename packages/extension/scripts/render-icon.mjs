// Renders scripts/icon.svg to media/icon.png (256x256), the Marketplace icon. The Marketplace does
// not accept SVG icons. Usage: node scripts/render-icon.mjs [path to Chrome]
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'scripts/icon.svg'), 'utf8');

const browser = await chromium.launch({ executablePath: process.argv[2] ?? process.env.CS_CHROME ?? '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: path.join(root, 'media/icon.png'), omitBackground: true });
await browser.close();
console.log('wrote media/icon.png');
