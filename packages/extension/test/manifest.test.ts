// Static checks of package.json contributions, since there is no display to run VS Code in tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_EXCLUDE } from '@change-spotlight/core';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const contributed = new Set<string>(pkg.contributes.commands.map((c: { command: string }) => c.command));
const sources = readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');

describe('package.json contributions', () => {
  it('only references contributed commands in menus and welcome links', () => {
    const referenced = Object.values(pkg.contributes.menus as Record<string, { command: string }[]>).flat().map((m) => m.command);
    for (const w of pkg.contributes.viewsWelcome as { contents: string }[]) {
      for (const m of w.contents.matchAll(/\(command:([\w.]+)\)/g)) referenced.push(m[1]!);
    }
    expect(referenced.filter((c) => !contributed.has(c))).toEqual([]);
  });

  it('registers every contributed command in the source', () => {
    const missing = [...contributed].filter((c) => !sources.includes(`registerCommand('${c}'`));
    expect(missing).toEqual([]);
  });

  it('points at icons that exist', () => {
    const icons = [
      ...pkg.contributes.viewsContainers.activitybar.map((c: { icon: string }) => c.icon),
      // gutter.ts builds these names from the three mark styles
      ...['unseen', 'seen', 'untrackable'].flatMap((n) => [`media/gutter-${n}-light.svg`, `media/gutter-${n}-dark.svg`]),
    ];
    expect(sources).toContain('`gutter-${name}-light.svg`');
    expect(icons.filter((icon: string) => !existsSync(path.join(root, icon)))).toEqual([]);
  });

  it('puts every view in a contributed container', () => {
    const containers = new Set(pkg.contributes.viewsContainers.activitybar.map((c: { id: string }) => c.id));
    expect(Object.keys(pkg.contributes.views).filter((c) => !containers.has(c))).toEqual([]);
    expect(pkg.contributes.views.changeSpotlight.map((v: { id: string }) => v.id)).toEqual(['changeSpotlight.changes']);
  });

  it('declares the ruler colors and settings the code uses', () => {
    const colors = new Set(pkg.contributes.colors.map((c: { id: string }) => c.id));
    for (const m of sources.matchAll(/ThemeColor\('([\w.]+)'\)/g)) expect(colors.has(m[1])).toBe(true);
    const settings = Object.keys(pkg.contributes.configuration.properties);
    for (const m of sources.matchAll(/getConfiguration\('changeSpotlight'\)\.get<[\w[\]]+>\('([\w.]+)'/g)) expect(settings).toContain(`changeSpotlight.${m[1]}`);
  });

  it('defaults changeSpotlight.exclude to the patterns the code falls back to', () => {
    expect(pkg.contributes.configuration.properties['changeSpotlight.exclude'].default).toEqual(DEFAULT_EXCLUDE);
  });
});
