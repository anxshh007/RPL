# src/webview — React + Vite panel (Member 5)

Not scaffolded yet: React, Vite and React Flow have to be installed with `npm install`, which records the exact versions in `package-lock.json`, so they come in through Member 5's first PR.

Planned layout (brief §7): `App.tsx`, `components/{Header,PromptInput,ActivityFeed,ImpactPanel,DependencyGraph,DiffReview,VerificationPanel,FinalSummary}`, `state/`, `hooks/`.

Rules:
- Build output goes to `/media` and is loaded by `src/extension` with a strict CSP.
- The panel uses only the messages in `src/shared/contracts/webview.ts` and the events in `events.ts`.
- No model calls, no shell commands, no workspace writes, no impact or test-output parsing in React.
- The webview gets its own `tsconfig.json` (DOM + JSX). The root `tsconfig.json` excludes this folder.
