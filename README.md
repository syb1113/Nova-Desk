# Nova Desk

DeepSeek-first desktop AI workspace prototype with HermesAgent-style workspace panels.

## Stack

- Electron desktop shell
- React + TypeScript + Vite
- Tailwind CSS
- Zustand + Jotai
- React Router
- TanStack Query
- Monaco Editor
- xterm.js

## Scripts

```bash
pnpm install
pnpm setup:hermes
pnpm hermes -- setup
pnpm hermes -- model
pnpm dev
pnpm build
pnpm start
```

Use `pnpm dev:web` when you only need the renderer in a browser.

## Project Shape

- `electron/` contains the Electron main process and preload bridge.
- `src/config/theme.config.json` is the source of truth for light and dark theme tokens.
- `src/config/theme.ts` applies those tokens as CSS variables.
- `src/workspaces/` contains the Hermes Agent chat workspace.
- `src/api/hermes.ts` is the renderer boundary for Hermes Agent calls.
- `electron/main.ts` runs the bundled Hermes Agent CLI via IPC.
- `vendor/hermes-agent/` is the project-local Hermes Agent checkout and venv.
- `vendor/hermes-home/` stores the app-local Hermes config, credentials, logs, and sessions.

## Hermes Agent

Nova Desk vendors Hermes Agent into this app. It does not require a global `hermes` command.

```bash
pnpm setup:hermes
pnpm hermes -- setup
pnpm hermes -- model
```

The wrapper sets `HERMES_HOME` to `vendor/hermes-home`, so Hermes configuration is isolated to Nova Desk.
