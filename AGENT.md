# AI Job Application Assistant — agent context

Monorepo for an AI-assisted job application flow: users sign in, save profile and resume, run a tailoring pipeline (job + resume → draft sections + cover letter), then use a Chrome extension side panel to drive in-browser autofill on application sites. A FastAPI backend owns persistence and LLM-backed generation; the MV3 extension is the primary UI and automation client. An optional Streamlit app (`streamlit_app/`) exercises the same HTTP API for manual testing.

## Stack

**Backend:** Python 3.11, FastAPI, Uvicorn, SQLAlchemy 2, Alembic, Pydantic v2 + pydantic-settings, PyJWT, httpx, boto3, python-docx, google-generativeai, pytest.

**Chrome extension:** TypeScript (strict), React 19, Vite 6, Tailwind CSS 3 + PostCSS, Zustand, lucide-react, `@types/chrome`, MV3 service worker + side panel + content scripts.

**Streamlit client:** streamlit, requests.

**Build:** `chrome-extension`: `tsc` + Vite (sidepanel + service worker bundles) + separate Vite config for content IIFE → `dist/content/content.js`.

## Repo tree (where to edit)

```
backend/app/
  main.py                 # FastAPI app, CORS + chrome-extension middleware, router mounts
  core/                   # settings, logging, security, deps
  db/                     # engine, session, Alembic
  common/                 # shared adapters, errors, resume parsing helpers
  modules/
    auth users admin resumes jobs pipeline applications drafts me
    ai/                   # LLM providers, prompts, orchestrator — used by pipeline/drafts, no standalone router
backend/tests/
streamlit_app/            # app.py + requirements (API smoke / workflow testing)
chrome-extension/src/
  background/service-worker.ts
  content/autofill.ts     # DOM autofill only; content.css
  sidepanel/
    App.tsx main.tsx index.html
    pages/                # workflow screens (default-export *Page components)
    components/           # layout, cards, chat, etc.
    hooks/                # useAuth.ts
    services/api.ts       # fetch client + JWT refresh + X-Session-Id
    store/index.ts        # Zustand useAppStore
    utils/                # sectionText, filename helpers
    workflowNavigation.ts # step rail + back-nav rules
    resumeLocalCache.ts
  shared/constants.ts     # API_BASE_URL, USER_APP_URL, STORAGE_KEYS, MSG
  shared/types.ts
  shared/autofill-answers.ts
chrome-extension/tailwind.config.js
chrome-extension/manifest.json
```

Skip `node_modules/`, `chrome-extension/dist/`, `backend/venv/`, `.venv/`, build caches.

## Rules (hard constraints)

- Do not pass autofill **answer maps** through `runtime.sendMessage`. Flat answers come from `chrome.storage.local` (`AUTOFILL_ANSWERS`), built via `buildAutofillAnswersFromProfile(profile)`; SW also refreshes local answers from `USER_PROFILE` on startup.
- One-way autofill start: sidepanel sets `AUTOFILL_TRIGGER_TS` in **`chrome.storage.session`** (content listens on the **session** `onChanged` for this key), then may send `BROADCAST_RUN_AUTOFILL`. Upload decisions use **`local`** (`AUTOFILL_UPLOAD_DECISIONS`) — same pattern: no answer payload in messages.
- Keep upload-blocker gating and user decisions intact before continuing fills.
- Single source for deploy API URL: `chrome-extension/src/shared/constants.ts` (`API_BASE_URL`, `USER_APP_URL`). Keep backend integration test default in sync when that host changes.
- Use `STORAGE_KEYS` / `MSG` from `shared/constants.ts` — no ad-hoc storage key strings.
- UI colors: Tailwind theme `wf.*` and `primary.*` from `chrome-extension/tailwind.config.js` — avoid arbitrary hex classes for product chrome.
- TypeScript `strict`; avoid `any` unless unavoidable with Chrome APIs — prefer `unknown` + narrowing.
- Do not add new npm or Python dependencies without explicit approval.
- Do not resurrect removed “unified autofill engine” layers (dom-runtime, form-model, site-learning, ATS adapter modules, etc.).
- Backend resume delete: `DELETE /resumes/{id}` returns **204** (no JSON body); extension must handle empty response.

## How things connect

**HTTP:** Extension `sidepanel/services/api.ts` is the only API surface for the panel: `fetch` to `API_BASE_URL`, attaches `Authorization` + `X-Session-Id` from `chrome.storage.local`, retries 401 via `/auth/refresh`. Pages and `useAuth` import `api.ts` directly (no separate hook layer required for every call).

**State:** `useAppStore` holds navigation (`PageId`), auth flags, profile, job, resumes, pipeline run, draft, cover letter, autofill progress, `autofillContext`. Workflow chrome (`WorkflowLayout`, `workflowNavigation.ts`) maps `PageId` ↔ step rail and enforces limited back navigation.

**Background:** Service worker opens side panel, relays messages, merges/persists `AUTOFILL_PROGRESS`, manages multi-page `AUTOFILL_SESSION` (URL success heuristics, `webNavigation`), rebuilds `AUTOFILL_ANSWERS` from `USER_PROFILE` on startup, calls `chrome.storage.session.setAccessLevel`, may POST application tracking — it does **not** own field-level autofill.

**Content:** `content/autofill.ts` owns scan → match → fill → progress in two passes: (1) native form elements (`<input>`, `<select>`, `<textarea>`), (2) custom dropdown components (`button[aria-haspopup="listbox"]`, `[role="combobox"]`). Observes session storage for triggers; respects activation gating, upload blockers, debounced `MutationObserver`, and max runs per activation.

**Backend:** Routers per domain in `modules/*/router.py`, mounted in `main.py`. Session-scoped rows use `X-Session-Id`. LLM logic lives under `modules/ai/` and is invoked from pipeline/drafts services — there is no top-level `/ai` router.

**Streamlit:** Standalone script using `requests` against the same REST API (tokens in session state).

## Critical paths (read before adding code)

| Concern | Path |
|--------|------|
| API base + storage/message contract | `chrome-extension/src/shared/constants.ts` |
| DTOs / `PageId` / autofill types | `chrome-extension/src/shared/types.ts` |
| Profile → flat answers for content | `chrome-extension/src/shared/autofill-answers.ts` |
| Global UI state | `chrome-extension/src/sidepanel/store/index.ts` |
| HTTP client | `chrome-extension/src/sidepanel/services/api.ts` |
| Step rail behavior | `chrome-extension/src/sidepanel/workflowNavigation.ts` |
| Theme tokens | `chrome-extension/tailwind.config.js` |
| Backend env + CORS | `backend/app/core/config.py` |
| App wiring | `backend/app/main.py` |

## Feature status

- [done] FastAPI: auth (JWT + refresh + Google OAuth path), users, resumes (upload/score/delete), jobs, pipeline, applications, drafts (sections, chat, apply-all docx), `me`.
- [done] Extension: login → profile → JD → resume (select or temp client-stored upload) → section editor → cover letter → autofill page; content autofill + upload blockers + multi-page session in background.
- [done] Streamlit API playground.
- [wip] Side panel workflow chrome / account menu (see `WorkflowLayout`, `AccountMenu`).
- [planned] Replace manifest OAuth `client_id` placeholder for production Chrome Identity sign-in.

## Gotchas

- `chrome.storage.session` is ephemeral (multi-page session + trigger stamp). **`AUTOFILL_ANSWERS` / upload decisions are in `local`** in current code — if `constants.ts` comments still say “session” for those keys, trust the read/write sites in `autofill.ts` / `AutoFillPage.tsx`.
- SW repopulates local `AUTOFILL_ANSWERS` from `USER_PROFILE` on each startup; auth/init paths must stay consistent.
- `chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })` is required so content scripts can use session area (trigger + `AUTOFILL_SESSION`).
- Background **merges** incoming `AUTOFILL_PROGRESS` so a late “complete with 0 fields” does not clear an active upload `blocked` state.
- CORS: custom middleware allows `chrome-extension://` origins; web origins use `ALLOWED_ORIGINS` from settings.
- `manifest.json` ships `oauth2.client_id` as `YOUR_GOOGLE_OAUTH_CLIENT_ID...` — real deployments must replace it.
- Cross-origin iframes: autofill only runs where the content script is injected; reliability varies by site.
- `ensureContentScriptInjected` was removed — manifest handles injection. Re-injection caused duplicate IIFE instances that fight over message channels ("listener indicated an asynchronous response by returning true, but the message channel closed before a response was received").
- Sidepanel sends `run_autofill` directly to the tab via `chrome.tabs.sendMessage` — no service-worker middleman for the trigger path.
- Content script `emitAutofillProgress` writes to **both** `chrome.runtime.sendMessage` and `chrome.storage.local` so progress reaches the sidepanel even if the service-worker relay path fails.
- Content script's `run_autofill` message handler always resets and runs (no one-shot guard on `autofillActivated`).
- `fillTextLikeOrCustomDropdown` always falls back to `fillTextLike` when `fillCustomDropdown` fails — Workday puts inputs inside `[role="combobox"]` containers but doesn't match the expected custom dropdown structure.
- `buildAutofillAnswersFromProfile` adds a static **Yes** for age-18+ eligibility keys (`are_you_18` + aliases) and extra ATS-style aliases for sponsorship, degree/education, salary, and work authorization — empty profile fields still yield no value for those keys until the user completes profile.
- **Extension context invalidated:** after reloading the unpacked extension or updating it, tabs that were already open keep an old content script; `chrome.storage` / `runtime` calls fail until the user **refreshes the job application tab**. The content script shows a top banner when this is detected and stops retry loops.
- **Top-frame only:** manifest sets `all_frames: false` and `initialize()` has a `window.self !== window.top` guard. Multi-frame execution caused races where an iframe's "complete, 0 fields" progress overwrote the main frame's "blocked on upload" progress in `chrome.storage.local`, preventing the sidepanel from showing the upload blocker UI.
- **Custom dropdown filling (Workday, Taleo, iCIMS):** Many ATS portals render their form dropdowns as custom components (`<button role="combobox" aria-haspopup="listbox">`, custom `<div>`-based selects) instead of native `<select>` elements. The content script's `collectFillableElements()` only finds native `<input>/<select>/<textarea>`, so these custom controls are invisible to the native scan. A second pipeline pass (`runCustomDropdownPass`) scans for `button[aria-haspopup="listbox"]` and `[role="combobox"]:not(input):not(select):not(textarea)`, extracts labels from their parent `[data-automation-id^="formField"]` containers, matches them to answer keys via `isStrongMatch`, then fills them by: click trigger → wait for `[role="listbox"]` → find best-matching `[role="option"]` → click it. Both native and custom results are combined into a single progress emit.
- **Pipeline steps:** Step 1 = load answers from `chrome.storage.local`. Step 2 = scan native form elements. Step 3 = match + fill native fields. Step 4 = scan + match + fill custom dropdowns. Step 5 = combine results and emit final progress. The pipeline no longer returns early on "0 native fields" — it continues to the custom dropdown pass.
- **Multi-page session creation:** `AutoFillPage.handleStartAutofill` now sends `AUTOFILL_SESSION_STARTED` to the background service worker (with `tabId` + `url`) so the background creates an `AUTOFILL_SESSION` in `chrome.storage.session`. Without this, the `tabs.onUpdated` listener in the service worker never sees an active session, meaning auto-triggering autofill on subsequent pages never fires. This was the root cause of "auto tracking not working."
- **Static universal answers:** `buildAutofillAnswersFromProfile` adds static answers for: `are_you_18` → "Yes", `willing_to_relocate` → "Yes", `subject_to_non_compete` → "No". These cover common ATS application questions that have universally expected answers.

## Naming conventions

- **Extension files:** Components `PascalCase.tsx` (usually `export default function …`). Pages end with `*Page.tsx`. Hooks: `useThing.ts` with **named** export `useThing`. Utilities: `camelCase.ts`.
- **Imports:** Use `@/` alias → `src/` (`"@/shared/types"`, etc.).
- **Python:** modules snake_case; routers `router.py`; Pydantic schemas in `schemas.py`.
- **CSS:** Tailwind utilities; shared palette under `wf` and `primary` in `tailwind.config.js`.
