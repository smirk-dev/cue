# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`VISION.md` is the standing brief (where we're going and what must not break). This file is how the code works **today**. Socrates is a fork of `cue`, a macOS Cluely-style overlay, rebuilt into a **Windows teaching-and-learning copilot**.

## Commands

```bash
npm install
npm start                        # electron .
npm run icons                    # regenerate build/icon.ico + tray.png (dependency-free rasterizer)
npm run pack                     # electron-builder --dir
npm run dist                     # electron-builder --win nsis → dist/Socrates Setup <version>.exe
SOCRATES_NO_PROTECT=1 npm start  # disable setContentProtection so the window is visible to screen recorders while debugging
```

There is no test suite, linter, or build step for the source — `renderer/` is plain HTML/CSS/JS loaded directly by Electron, and `asar` is off in the build config, so a packaged app contains the same readable files. `node --check` on each JS file is the cheap first gate; real verification is booting the app and driving it.

## Platform

The app targets **Windows**. `setContentProtection(true)` maps to `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows 10 version 2004+ (build 19041). On older builds it degrades to a black box, so `warnIfProtectionFallback()` in `main.js` checks `os.release()` and warns. Windows has **no screen-recording permission**; only the microphone is gated (Settings → Privacy → Microphone). `app.dock.hide()` no-ops and `skipTaskbar` is true, so the **tray icon is the only way to reach the app once the overlay hides**. The `mac` build block is kept but `dist` builds Windows.

Verify on the real thing: DPI scaling lies to naive instruments — any screenshot tool used to check this app must call `SetProcessDPIAware()` first, or a correctly-placed window looks misplaced and 2× (a 1280×800 crop at 150% scaling). Suspect the instrument before the app.

## Architecture

Electron, two processes, `contextIsolation: true` and `nodeIntegration: false`. All provider SDK calls happen in the main process; the renderer never sees an API key. The renderer bridge is `window.socrates` (preload).

**The load-bearing design decision:** both audio streams are captured in the **renderer**, not the main process. `getUserMedia` (mic) and `getDisplayMedia` (system loopback, WASAPI on Windows) run inside Socrates' own process so they use its own capture grant — no separate helper binary to authorize. `main.js` installs a `setDisplayMediaRequestHandler` that hands back `{ video: sources[0], audio: 'loopback' }` to make the loopback grab work headlessly (no system picker).

Data flow for audio: renderer `ScriptProcessor` → Int16 PCM → `socrates.micPcm()` / `socrates.systemPcm()` over IPC → `buffers.you` / `buffers.them` in main → a 3.5s `setInterval` flush → RMS silence gate → `pcmToWav` → STT → `transcript[]` (capped at `TRANSCRIPT_CAP`) → back to the renderer as a `transcript` event. The **"you" and "them" channels are kept separate end-to-end** so prompts can attribute who said what; the tutoring modes depend on that distinction.

Two independent provider axes, deliberately decoupled:

- **`src/llm.js`** — `createLLM(settings)` returns one `stream({system, turns, imageDataUrl, onToken})` interface over OpenAI / Anthropic / Gemini. Each provider attaches the image differently (`image_url`, base64 `source`, `inlineData`), and only to the **last user turn**. Model choice comes from `settings.models[provider][smart ? 'smart' : 'fast']`.
- **`src/stt.js`** — `createSTT(settings)` is a **fallback chain**, not a single provider, because Anthropic has no audio API. It tries whatever audio-capable key exists (OpenAI Whisper, then Gemini) regardless of which provider is selected for chat. This is why an Anthropic-only user gets the screen features but no listening.

STT errors set a module-level `sttDisabled` latch in `main.js` — a 403 from a chat-only key would otherwise re-fire every 3.5s. `settings:set` clears the latch.

## Modes are symmetric (the product thesis)

`src/prompts.js` `MODES` is where the teaching/learning distinction lives. Every mode is designed **twice** — a `learning` block and a `teaching` block, each with `{ userBubble, system, build(ctx) }` — plus shared `needsScreen` / `small` flags. The `role` setting (`learning` | `teaching`) picks which block runs; `runFeature()` reads `def[role]`. The **Learn / Teach** toggle in the toolbar swaps it, and `MODE_LABELS` in `renderer.js` swaps the action-button labels to match. The design rule: when a mode could hand over an answer or build understanding, it builds understanding (e.g. `hint` gives a Socratic nudge, never the solution).

## Adding a feature

Add an entry to `MODES` with `needsScreen`, `small`, and **both** `learning` and `teaching` sub-objects (each `{ userBubble, system, build(ctx) }`); `runFeature()` handles screenshot capture, streaming, and the busy lock generically. To surface it, add a `.act` button with a matching `data-mode` and a `.lbl` span in `renderer/index.html`, an icon assignment + a `MODE_LABELS` entry per role in `renderer.js`. A global shortcut needs one line in `registerShortcuts()`.

## Constraints worth knowing before you edit

- **Preload allowlist.** `preload.js` allowlists the channels the renderer may listen on. A new main→renderer event is silently dropped until it's added there — no error.
- **Click-through.** The window is fully click-through by default; a `mousemove` handler calls `elementFromPoint` and re-enables mouse events only over `#toolbar, #panel-wrap, #settings-scrim, #onboard-scrim`. New top-level interactive UI outside those selectors is unclickable (this is why the Learn/Teach toggle lives inside `#toolbar`).
- **CSP + no bundler.** `renderer/index.html` sets `script-src 'self'` and there is no build step, so renderer code can't `require()` or load remote scripts. Icons are inlined Lucide paths in `renderer/icons.js` for this reason — `lucide-static` is a dependency but is not loaded at runtime.
- **Markdown rendering is hand-rolled** (`renderMarkdown` in `renderer.js`) and escapes HTML itself. LLM output flows into it, so keep it escaping-first — it supports only fenced code, bullets, inline code, and bold.
- **Settings are a plain JSON file** (`src/store.js` → `socrates-data.json` in `userData`, deep-merged over `DEFAULTS`, gitignored). It falls back to the legacy `cue-data.json` on read so a pre-rebrand install keeps its keys. No native modules by design, to keep `npm install` clean.
- **Icons are generated, not committed art.** `build/make-icons.js` rasterizes the pinwheel-in-ring mark (Node `zlib` only, no deps) into `build/icon.png|ico` and `tray.png`. `main.js` loads `build/tray.png` for the tray with a base64 fallback if missing.

## Project character

Socrates is intentionally small and readable — a stated goal, not an accident. It's also a tool with real misuse potential; the README's disclaimer (proctored exams, interviews, consent laws) and its honesty that hiding is **best-effort and pixels-only** — `WDA_EXCLUDEFROMCAPTURE` hides the window from capture but the process and window handle stay fully enumerable — are load-bearing. Never soften those claims or describe the hiding as guaranteed or "undetectable," in code, UI, docs, or commit messages.
