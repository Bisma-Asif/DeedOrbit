# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Route switch, session bootstrap, and tenant state
- `src/index.css` - Global CSS entrypoint, Tailwind CSS v4 import, and the design tokens every feature inherits
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, typecheck, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

### DeedOrbit conventions

- `src/components/ui/` - shadcn/ui primitives. Add new primitives here; do not inline one-off widgets in a page.
- `src/components/layout/` - `app-shell.tsx`, `sidebar.tsx`, and `top-bar.tsx`. The shell owns chrome; pages own content only.
- `src/components/` - Shared patterns: `data-table.tsx` (sorting, pagination, filter bar, sticky header), `stat-card.tsx`, `page-header.tsx`, `empty-state.tsx`, `field.tsx`.
- `src/features/` and `src/pages/` - Feature and route-level screens.
- `src/lib/` - `navigation.ts` (the module registry — add new modules there), `router.ts`, `format.ts`, `workspace.ts`, `use-media-query.ts`, `utils.ts`.

Design rules that must hold for every screen: deep slate/navy chrome, emerald as the only accent, amber for pending/due and muted red for overdue/danger only, off-white `#F8FAFC` content background, business-dense padding (32px controls, 13px body, 11px table headers), no purple/violet, no gradients, no glassmorphism, no glow, and no emoji as icons. Never fabricate a value where there is no data — show a dash and say so.

## Dependencies

- Runtime: React 19 and React DOM 19
- UI: shadcn/ui on Radix UI primitives, `class-variance-authority`, `clsx`, and `tailwind-merge`; icons from `lucide-react`
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Tokens are declared as CSS custom properties in `:root` and mapped to Tailwind colors through a single `@theme inline` block — add new tokens there rather than hard-coding hex values in JSX. The font stack is local by design; do not add a webfont `@import`, because the product runs on locked-down intranets.

## Code quality

- Run `pnpm run typecheck` and `pnpm run format` before finishing. **Always run `typecheck` after `format`.**

### oxfmt strips separators from object type literals

`oxfmt` rewrites an object **type literal** and removes the separators between its members. It strips `;` *and* `,` alike, so swapping one for the other does not help:

```ts
type Row = { id: string; status: string }   // becomes: type Row = { id: string status: string }
```

`oxfmt` never *adds* a line break, so the practical rule is: **never write a multi-member object type literal on a single line.** Two safe forms:

- A named `interface`. Its body is always reformatted one member per line and survives untouched. This is the preferred form.
- A multi-line `type` literal whose members are newline-separated and carry no `;` or `,` — a newline is already a valid member separator in TypeScript, so it is stable.

Single-member literals such as `{ ok: true }` are safe on one line either way.

Two more rewrites to watch for: `readonly (keyof T)[]` becomes `readonly keyof T[]`, which parses as something else entirely — introduce a named alias (`type Column = keyof Row`, then `readonly Column[]`). And a `type X = A | { … } | B` union can collapse; give each arm its own interface.

This broke 47 sites across 12 files before the codebase was converted. It now survives repeated `format` runs.
- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
