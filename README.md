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
- `electron/main.ts` registers the IPC bridge; `electron/hermes-runtime.ts` manages each Python turn and cancellation.
- `scripts/hermes-bridge.py` connects directly to the bundled Hermes `AIAgent` callbacks over NDJSON.
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

## Desktop chat

The current integration is validated for DeepSeek, Kimi, GLM and Mimo using their OpenAI-compatible interfaces. Existing navigation entries are retained. Set the API key, base URL and exact model ID in Settings; use a base URL, not a full `/chat/completions` URL. Subscription/coding plans can require their own endpoint and key. Mimo model names are normalized by Hermes.

The desktop sends explicit model credentials over the child process stdin, receives real text deltas and tool events, and forwards dangerous-command approvals and clarification requests to the chat. Only one-time approval or denial is exposed. Settings tests disable tools. Stop interrupts Hermes and force-cleans the process tree after five seconds on Windows if necessary. Executed tool actions are not rolled back; retry can execute them again.

Completed native message histories, including tool messages, are committed atomically under Electron's `userData/sessions`. Failed and cancelled turns preserve the last completed checkpoint. The first turn of a legacy local conversation imports its completed text history. Chat UI state remains in localStorage (including model keys; OS credential encryption is not implemented).

Each turn currently uses a separate Python process. Background terminal process handles do not survive across turns; use foreground commands for this version. Native message persistence does not imply persistent terminal environments.

`HERMES_PYTHON_PATH` can override the bundled Python executable. Packaged distributions must include `vendor` and `scripts/hermes-bridge.py` under resources. Installer packaging is not configured in this repository.

## Validation

```bash
pnpm build
node scripts/test-hermes-runtime.mjs
node node_modules/electron/cli.js scripts/test-desktop.cjs
```

The runtime test uses the real vendored Hermes with a local mock HTTP endpoint and temporary home. It covers four providers, streaming, native history, cancellation, clarification and API failures. The desktop test uses a hidden Electron window, temporary storage and simulated IPC responses to check UI/preload behavior. These checks do not certify a live provider account or quota.

Provider references: [DeepSeek](https://api-docs.deepseek.com/), [Kimi](https://platform.kimi.com/docs/get-api-key), [GLM](https://docs.bigmodel.cn/cn/guide/develop/http/introduction), [Mimo](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call).
