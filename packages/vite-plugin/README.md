# @change-spotlight/vite-plugin

The Vite half of [Change Spotlight](https://github.com/Rijja-Farhan/ChangeSpotlight): see which UI
changes on your branch you have actually looked at in the browser.

It needs the **Change Spotlight** VS Code extension, which computes the diff and keeps the
"Seen X of Y" count.

## Install

```bash
npm i -D @change-spotlight/vite-plugin
```

```ts
// vite.config.ts
import changeSpotlight from '@change-spotlight/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [changeSpotlight(), react()],
})
```

Works with both `@vitejs/plugin-react` and `@vitejs/plugin-react-swc`. Requires Vite 8 or later.

Open the repository root in VS Code and run the dev server. The plugin and the extension find each
other through a discovery file inside `.git/`.

## What it does

- Tags lowercase host elements in `.jsx`/`.tsx` files with `data-cs-loc="path:start-end"`, with
  source maps, so breakpoints still land on the right lines. Components and fragments are never tagged.
- Injects a small script that reports which tagged elements have been on screen (at least 50% visible
  for 300 ms in a focused tab) and draws the overlay: outlines, labels, arrows and the "what is left" panel.
- Relays those reports to the extension over a WebSocket on `127.0.0.1` protected by a random token.

It only runs in `vite serve` (`apply: 'serve'`). Production builds contain none of it.

## Options

```ts
changeSpotlight({
  enabled: true,           // false turns the plugin off
  include: /\.[jt]sx$/,    // files to tag
  exclude: /\/node_modules\//, // files never to tag
})
```

## License

MIT
