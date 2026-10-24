# Change Spotlight

See which UI changes on your branch you have actually looked at in the browser.

Change Spotlight compares your branch with its base (`main` by default), finds the changed JSX
elements, and follows you while you click through the running app. A change counts as seen once at
least half of it has been on screen for 300 ms in a focused tab. VS Code shows "Seen X of Y", and the
browser outlines what is left, so nothing ships without someone looking at it first.

It has two parts that work together:

- a **VS Code extension** that reads `git diff`, keeps the seen count per branch and shows it in a
  Changes view, the status bar and the gutter;
- a **Vite plugin** that tags changed elements in the dev server, reports what has been on screen and
  draws the in-browser overlay.

Everything runs locally. Nothing leaves your machine, and production builds are untouched.

## Quick start

1. Install the **Change Spotlight** extension in VS Code.
2. In your React + Vite project, install the plugin:

   ```bash
   npm i -D @change-spotlight/vite-plugin
   ```

3. Add it to `vite.config.ts`, before the React plugin:

   ```ts
   import changeSpotlight from '@change-spotlight/vite-plugin'
   import react from '@vitejs/plugin-react'
   import { defineConfig } from 'vite'

   export default defineConfig({
     plugins: [changeSpotlight(), react()],
   })
   ```

4. Open the **repository root** in VS Code, check out your branch and start the dev server
   (`npm run dev`). The extension and the dev server find each other on their own.

Requirements: a git repository, Vite 4 or later, React with `.jsx`/`.tsx` files
(`@vitejs/plugin-react` or `@vitejs/plugin-react-swc`), and VS Code 1.100 or later.

See the [extension README](packages/extension/README.md) for commands and settings, and the
[plugin README](packages/vite-plugin/README.md) for plugin options.

## How it works

1. The Vite plugin tags host elements (`<div>`, `<button>`, ...) in `.jsx`/`.tsx` files with their
   source location (`data-cs-loc`) while the dev server runs. Components and fragments are never
   tagged, and source maps are preserved.
2. A small script in the page watches the tagged elements and reports the ones you have seen.
3. The plugin relays those reports over a token-protected WebSocket on `127.0.0.1` to the extension.
   They discover each other through a file inside `.git/`.
4. The extension matches the reports against the hunks of `git diff <base>...HEAD` and stores what
   you have seen per branch.

## Repository layout

This is a pnpm workspace.

| Path | What it is |
|---|---|
| [`packages/core`](packages/core) | `@change-spotlight/core`: diff parsing, hunk matching, the seen model and the protocol types. No dependencies. |
| [`packages/vite-plugin`](packages/vite-plugin) | `@change-spotlight/vite-plugin`: the JSX transform, the in-page script and overlay, and the bridge to the extension. |
| [`packages/extension`](packages/extension) | The VS Code extension: git layer, Changes view, decorations and the seen store. |
| [`playground`](playground) | A small React + Vite app for trying everything out by hand. |

## Development

Requires Node 22 or later and pnpm (the version is pinned in `package.json`; `corepack enable`
picks it up).

```bash
pnpm install
pnpm build       # build every package
pnpm typecheck   # type-check sources and tests
pnpm test        # run the Vitest suites
```

To run the extension against the playground, open this folder in VS Code and start the
**Run Change Spotlight** launch configuration (F5). It builds the extension, opens the playground in
an Extension Development Host, and from there you run `pnpm --filter playground dev`.

The playground uses `@vitejs/plugin-react-swc` by default. Set `CS_REACT=react` to use
`@vitejs/plugin-react` instead.

## License

[MIT](LICENSE) © Rijja Farhan
