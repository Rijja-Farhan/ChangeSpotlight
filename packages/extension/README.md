# Change Spotlight

See which UI changes on your branch you have actually looked at in the browser.

Change Spotlight compares your branch with its base (`main` by default), finds the changed JSX
elements, and follows you while you click through the running app. A change counts as seen once at
least half of it has been on screen for 300 ms in a focused tab. VS Code shows "Seen X of Y", and the
browser outlines what is left.

## Setup

Change Spotlight has two parts: this extension and a Vite plugin.

1. Install this extension.
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

Requirements: a git repository, Vite 4 or later, React with `.jsx`/`.tsx` files, and
VS Code 1.100 or later.

## What you get

- **Changes view** in the activity bar: changes grouped by page, with a "Seen X of Y" counter.
  Click one to open the code.
- **Status bar** counter, and gutter marks for seen and unseen changes.
- **Browser overlay**: amber outlines on changes you have not seen yet, green once seen, a ring while
  one is being counted, arrows to changes above and below, and a panel listing what is left on this
  page and on other pages. Toggle it with `Alt+Shift+S` or the eye button.

The overlay and the tagging only run in the dev server. Production builds are untouched.

## Commands

| Command | What it does |
|---|---|
| Change Spotlight: Refresh Changes | Recompute the diff now |
| Change Spotlight: Reset Seen | Mark every change on this branch as unseen |
| Change Spotlight: Mark as Seen / Mark as Unseen | Change one change's state by hand |

## Settings

| Setting | Default | |
|---|---|---|
| `changeSpotlight.baseBranch` | `""` | Branch or ref to compare against. Empty tries `main`, `master`, `origin/main`, `origin/master`. |
| `changeSpotlight.exclude` | tests, fixtures, stories | Glob patterns for changed files that never count toward "Seen X of Y". They still show in the Changes view as not trackable. |
| `changeSpotlight.openOnClick` | `true` | Clicking an element in the browser opens its code in the editor. |
| `changeSpotlight.overlay.showByDefault` | `true` | Show the browser overlay when a page opens. |
| `changeSpotlight.overlay.hideSeen` | `false` | Hide the outlines of changes you have already seen. |

## How it works

The Vite plugin tags host elements (`<div>`, `<button>`, ...) with their source location while the
dev server runs. A small script in the page reports which tagged elements you have seen. The plugin
passes this over a local, token-protected WebSocket to the extension, which matches it against
`git diff` and stores what you have seen per branch. Nothing leaves your machine.
