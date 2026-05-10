# UI-TARS-Desktop Audit Report

**Source:** https://github.com/bytedance/UI-TARS-desktop.git  
**Version:** 0.2.4  
**Audited:** 2026-05-10  
**Auditor:** Claude Code

---

## Setup Summary

- Cloned from upstream and installed 2,628 packages via `pnpm install`
- Build completed successfully after one fix (see below)
- Electron app launches on Linux with Xvfb
- TypeScript typechecking: **PASS** (zero errors)
- Tests: **263 pass / 57 fail** (all failures require Chrome/Chromium not present in this environment)

---

## Bug Fixed: Build Crash on Missing Env Var

**File:** `apps/ui-tars/electron.vite.config.ts`  
**Severity:** High (blocks all production builds unless `UI_TARS_APP_PRIVATE_KEY_BASE64` is set)

The `bytecodePlugin` received `undefined` in `protectedStrings` when the env var was absent, causing:

```
[vite:bytecode] Cannot read properties of undefined (reading 'replace')
```

**Fix applied:**
```diff
- protectedStrings: [process.env.UI_TARS_APP_PRIVATE_KEY_BASE64!],
+ protectedStrings: [process.env.UI_TARS_APP_PRIVATE_KEY_BASE64].filter(Boolean) as string[],
```

---

## Security Findings

### 1. `webSecurity` Disabled in Production (High)

**File:** `apps/ui-tars/src/main/window/createWindow.ts:40`

```ts
webSecurity: !!env.isDev,  // true in dev, FALSE in production
```

In production builds (`NODE_ENV=production`), `isDev` is `false`, so `webSecurity` is disabled. This allows the renderer process to make cross-origin requests without restriction, undermining Electron's built-in protections against CSRF and mixed-content attacks.

**Recommendation:** Flip the logic or explicitly set `webSecurity: true`:
```ts
webSecurity: true,
```

### 2. `nodeIntegration: true` + `contextIsolation: false` in Overlay Windows (Medium)

**File:** `apps/ui-tars/src/main/window/ScreenMarker.ts:62, 229`

Overlay windows used for screen annotations are created with:
```ts
webPreferences: { nodeIntegration: true, contextIsolation: false }
```

These windows load only `data:` URIs (no external content), limiting the attack surface. However, this pattern is an Electron security anti-pattern. If the loaded URL ever changes, or a prototype pollution attack occurs, full Node.js access is exposed.

**Recommendation:** Use a preload script instead of `nodeIntegration: true`, or at minimum verify these windows never navigate away from data URIs.

### 3. `sandbox: false` in Main Window (Low-Medium)

**File:** `apps/ui-tars/src/main/window/createWindow.ts:39`

Disabling the renderer sandbox reduces defense-in-depth. This is required when `nodeIntegration` is also false but a preload with Node access is used, which is the case here.

**Recommendation:** Document this intentional trade-off in the codebase. Consider using a more restrictive CSP alongside the disabled sandbox.

### 4. DevTools Extension Installer Broken at Runtime (Low)

**File:** `apps/ui-tars/src/main/main.ts:62`

```ts
// @ts-ignore
const installExtension = installExtensionDefault?.default;
```

At runtime this evaluates to `undefined` (double `.default` from ESM interop), producing a logged error:
```
TypeError: installExtension is not a function
```

This is a dev-mode-only error that doesn't affect production, but it degrades the developer experience.

**Recommendation:**
```ts
const installExtension = installExtensionDefault;
```

---

## Code Quality

### ESLint: 539 Errors

Running `pnpm lint` reports 539 errors across the monorepo:

| Rule | Count |
|---|---|
| `@typescript-eslint/no-explicit-any` | ~467 |
| `react/no-unescaped-entities` | 20 |
| `no-useless-escape` | ~14 |
| `no-empty` | 5 |
| `@typescript-eslint/no-non-null-asserted-optional-chain` | 4 |
| `no-control-regex` | 2 |

The `no-explicit-any` dominance suggests the TypeScript strictness was tightened after initial development. These are low-risk but represent type-safety debt.

### Build Warnings

- **Large chunks:** Several renderer bundles exceed 500 KB (main bundle: 582 KB). Code splitting with dynamic imports would improve initial load time.
- **`eval()` in jimp:** The `jimp` image library uses `eval()` in its browser bundle (build warning). This is a third-party issue but is worth noting for CSP compliance.

---

## Test Results

```
Test Files:  11 failed | 23 passed (34)
Tests:       57 failed | 263 passed | 23 skipped (343)
```

All 57 failures are in `packages/agent-infra/mcp-servers/browser` and require a local Chrome/Chromium browser. They fail uniformly with `Unable to find any browser.` These tests would pass in an environment with a browser installed.

The 263 passing tests cover SDK behavior, MCP client/server protocol, action parsing, DOM views, and more.

---

## Runtime Observations (Xvfb headless)

The Electron app starts cleanly on Linux:
- Main process initializes correctly
- Tray and main window are created
- Accessibility check passes
- Browser availability check gracefully handles no-browser case
- IPC routes registered

Non-fatal environment errors (headless server):
- D-Bus not available (expected — no system bus in container)
- GPU process exits (expected — no GPU in container)

---

## Dependency Vulnerabilities (`pnpm audit`)

**225 vulnerabilities found: 4 critical | 83 high | 105 moderate | 33 low**

Notable findings:

| Severity | Package | Issue | Fix |
|---|---|---|---|
| Critical | `electron@34.1.1` | Clipboard image data exposure (GHSA-f37v-82c4-4x64) | Upgrade to >=39.8.5 |
| Low | `axios` (via `opencommit`) | Null byte injection in URL params (GHSA-xhjh-pmcv-23jw) | Upgrade axios >=1.15.1 |

The `electron` version pinned at `34.1.1` is **5 major versions behind** the patched release (39.8.5). This is the most impactful finding — the app is shipped with a vulnerable version of the core runtime. Upgrading electron across a major version boundary requires testing for API compatibility breaks.

Many of the 225 vulnerabilities are transitive dependencies of dev tools (build tooling, test runners) and do not ship in the final packaged app.

---

## Recommendations Priority

| Priority | Issue |
|---|---|
| **P0** | Fix `webSecurity: !!env.isDev` — currently disables security in production |
| **P0** | Upgrade `electron` from 34.1.1 to >=39.8.5 (critical CVE) |
| **P1** | Remove `nodeIntegration: true` from ScreenMarker overlay windows |
| **P2** | Fix `installExtension` runtime error in dev mode |
| **P3** | Address ESLint `any` debt (consider gradual typing) |
| **P3** | Add browser to CI to enable browser MCP server tests |
