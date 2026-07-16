# VISION.md — the standing brief

Reread this at the start of every session. It says where we're going and what must not
break along the way. `CLAUDE.md` says how the code works today; this says what we're
turning it into and why.

---

## Decisions already made — do not re-litigate

- **The name is Socrates.** It carries the thesis: the tool asks the question rather
  than handing over the answer. Rebrand target across `appId`, the `window.cue` bridge,
  the settings file, the `CUE_NO_PROTECT` env var, the mode system prompts, and the docs.
- **Both sides are first-class, symmetric.** Not a learner tool with teacher bolted on.
  A mode toggle swaps the whole prompt set between *teaching* and *learning*. Everything
  in `MODES` gets designed twice, deliberately.
- **Windows truth comes before Windows polish.** Boot it, drive every path, find out
  what's actually broken, then build.

---

## Why this exists

We are building a **teaching and learning assistant** — a copilot that sits over a live
session and helps on both sides of it: the person explaining and the person trying to
understand. It runs on **Windows**, as a real installed application with an icon, a tray
presence, and an installer — not a dev script someone runs from a terminal.

It starts from `cue`, an open-source, macOS-only, Cluely-style overlay. The bones are
good: ~700 lines across ten files, two Electron processes, three inputs (screen, mic,
system audio) feeding one LLM, provider-agnostic on both the chat and speech axes. We
are keeping the bones and rebuilding almost everything around them.

The reason the tutoring frame matters: every design call should be made for someone who
is **trying to learn or trying to teach**, not someone trying to bluff through an
interview. When a mode could either hand over an answer or build understanding, build
understanding. That single distinction is what separates this from the thing it forked
from, and it should be visible in the prompts, the modes, and the UI.

---

## Where we are starting from

Ground truth as of this brief — verify before trusting, but this is what's on disk:

| File | What it does | Port exposure |
| --- | --- | --- |
| `main.js` | Window, capture toggle, 3.5s STT flush loop, `runFeature()`, IPC, shortcuts | `app.dock.hide()` no-ops; `setHiddenInMissionControl` already guarded; loopback handler is fine |
| `preload.js` | `contextBridge` surface + a hardcoded channel allowlist | Rename ripples through `window.cue` |
| `src/llm.js` | `createLLM(settings)` → one `stream()` over OpenAI / Anthropic / Gemini | Model defaults are stale |
| `src/stt.js` | `createSTT(settings)` → fallback chain, not one provider | Whisper then Gemini; no Anthropic audio API |
| `src/prompts.js` | `MODES` — declarative features: `needsScreen`, `userBubble`, `small`, `system`, `build(ctx)` | This is where tutoring lives |
| `src/store.js` | JSON settings at `cue-data.json` in `userData` | Filename and defaults change |
| `src/screen.js` | `desktopCapturer` full-res screenshot | Works on Windows; multi-monitor is naive |
| `src/wav.js` | PCM → WAV, RMS | Fine |
| `renderer/` | Plain HTML/CSS/JS, CSP `script-src 'self'`, no bundler | Onboarding is macOS-only |
| `package.json` | `build` block has **only** a `mac` target; `dist` is `--mac zip` | No Windows packaging exists yet |

---

## What is true on Windows

Do not carry the macOS mental model over. The platform facts that actually govern this
port:

**Invisibility gets better, not worse — verified on this machine.**
`win.setContentProtection(true)` becomes `SetWindowDisplayAffinity(hwnd,
WDA_EXCLUDEFROMCAPTURE)` on Windows 10 version 2004 and later. That excludes the window
from the desktop-duplication and window-capture paths that Zoom, Teams, Meet, and OBS
use. This is the original trick, on its original platform. On builds older than 2004 the
affinity falls back to `WDA_MONITOR`, which renders the window as a black rectangle to
capturers rather than hiding it — a visible black box is a worse failure than no
protection, so detect the build and decide deliberately.

Measured 2026-07-17 on Windows 11 Home, build 26200, 1920×1200 @ 150% scaling,
Electron 33.2.1, unpackaged:

- Booted clean. The overlay renders correctly — transparency, frameless toolbar, blur
  panel, click-through. No console errors.
- With protection on, a DPI-aware full-desktop GDI capture (`CopyFromScreen` over
  1920×1200) shows **no trace of the window**. `GetWindowDisplayAffinity` returns **17**
  (`WDA_EXCLUDEFROMCAPTURE`). The feature works, unmodified, out of the box.
- **And at the same moment**, `EnumWindows` returns the window with `IsWindowVisible` =
  true and the title string `cue`. Hidden pixels, fully enumerable handle.

That last bullet is the honesty constraint as an experiment rather than an opinion. Keep
it in mind every time you're tempted to write "undetectable."

**The window title is a detection vector.** It is currently the literal string `cue`, and
anything sweeping window titles reads it instantly. Renaming it to `Socrates` makes it
*more* self-incriminating, not less. Decide the shipped title deliberately — this is a
product call, not a rename detail, and it belongs to the user.

**DPI scaling will lie to your instruments.** At 150% scaling a DPI-unaware capture
returns a 1280×800 crop of the physical screen and makes a correctly-centered window look
misplaced and double-sized. Two bugs were reported from that artifact before the
instrument was fixed. Any screenshot tool used to verify this app must call
`SetProcessDPIAware()` first. Suspect the instrument before the app.

**System audio gets easier.** `audio: 'loopback'` in `setDisplayMediaRequestHandler`
(`main.js:196`) is backed by WASAPI loopback on Windows and has been the more reliable
path of the two platforms. The renderer-side capture design — both streams grabbed in
the renderer so they use the app's own process and grant — stays exactly as it is. It
was the right call for a different reason on macOS, and it is still the right call here.

**Permissions mostly evaporate.** Windows has no Screen Recording permission. The
microphone is gated by Settings → Privacy → Microphone, and
`systemPreferences.getMediaAccessStatus('microphone')` reports it. Every
`x-apple.systempreferences:` deep link in the onboarding flow is dead code on Windows
and needs a Windows answer or removal — not a translation.

**Nothing replaces the dock.** `app.dock.hide()` silently does nothing. `skipTaskbar`
is already set. A tray icon is the only way the app is reachable once the overlay is
hidden, and it does not exist yet.

**Transparency is quirkier.** `transparent: true` with `frame: false` works, but on
Windows it interacts badly with resizing and with some GPU configurations. Expect to
find this the hard way; when you do, write down what you found rather than papering
over it.

---

## The honesty constraint

The upstream README is blunt that invisibility is **best-effort** and that this tool has
real misuse potential — proctored exams, interviews, consent law. That bluntness is
load-bearing and it survives the rebrand intact. Sharpen it for Windows rather than
softening it:

`WDA_EXCLUDEFROMCAPTURE` hides pixels from capture APIs. It does **not** hide the
process, the window handle, the entry in the window list, or anything an `EnumWindows`
sweep or a proctoring agent enumerating running processes would see. It does nothing
about a phone pointed at the screen or a hardware capture card. "Invisible to screen
capture" is the true claim. "Undetectable" is not, and we do not make it.

Never describe the hiding as guaranteed. Not in the README, not in the UI, not in a
commit message, not to me.

---

## What we're building

Roughly in dependency order, but this is a map and not a ticket queue — sequence it as
the work actually reveals itself.

**Make it run and ship on Windows.** Booting and content protection are already
confirmed working (see above) — that risk is retired, and the remaining work is
packaging and the paths that need a live call to test. A `win` block in the build config
(none exists today; `dist` is `--mac zip`), NSIS installer, a real `.ico`, an app icon
that looks like something. Add a tray icon with show/hide/quit — `app.dock.hide()`
no-ops and `skipTaskbar` is already true, so once the overlay hides there is currently
**no way to reach the app at all**. Still unverified and needing a real call: the
loopback audio grab, mic capture, the screenshot path, and the global shortcuts. Replace
the macOS onboarding with one that reflects a platform that mostly does not ask for
permission.

**Rebrand it.** New name across the product surface, the `appId`, the `window.cue`
bridge, the settings filename, the `CUE_NO_PROTECT` env var, the mode system prompts
that say "You are cue", and the docs. Handle the settings-file rename so an existing
install doesn't silently lose its keys.

**Make the modes tutor-shaped.** The current `MODES` are built for a person bluffing
through a call: `assist` hands over a LeetCode solution, `say` writes the user's next
sentence for them, `leetcode` exists at all. Those are the wrong defaults for us.
Explaining, checking understanding, asking the Socratic question instead of giving the
answer, catching the moment a learner is lost, summarizing what was actually taught —
that is our surface. Adding a mode is genuinely one entry in `MODES` plus a `.act`
button with a matching `data-mode`; the cost is design judgment, not code.

**Make it robust.** The `sttDisabled` latch, the busy lock, the silence gate, and the
error paths were written for a demo. Long teaching sessions are a different load: the
transcript array grows unbounded, `runFeature` drops calls silently when busy, and a
provider hiccup surfaces as a string in a status bar.

---

## What must not break

- **No API key ever reaches the renderer.** All provider SDK calls stay in main.
- **"You" and "them" stay separate end to end.** Several modes depend on knowing who
  said what, and the tutoring modes depend on it more than the originals did.
- **The preload allowlist is real.** A new main→renderer event is silently dropped until
  it's listed in `preload.js`. Silently. You will not get an error.
- **Click-through is real.** New top-level interactive UI outside `#toolbar`,
  `#panel-wrap`, `#settings-scrim`, `#onboard-scrim` is unclickable until the
  `mousemove` handler's selector list knows about it.
- **CSP and no bundler.** `script-src 'self'`, no build step. Renderer code cannot
  `require()` or pull remote scripts. Icons are inlined Lucide paths for this reason.
- **`renderMarkdown` escapes HTML itself.** LLM output flows into it. Keep it
  escaping-first.
- **No native modules.** `npm install` stays clean. That's why settings are a JSON file.
- **Small and readable is a feature.** The upstream README states it as a goal. `asar`
  is off so a packaged app ships readable source. Don't let this become a framework.

---

## How to work on this

**Act when you have enough.** Don't re-derive what's already established or re-litigate
a settled decision. If you're weighing options, recommend one — don't survey.

**Stay in scope.** Don't add features, refactor, or introduce abstractions beyond what
the task requires. A bug fix doesn't need surrounding cleanup. Don't build for
hypothetical future requirements or add error handling for cases that can't happen.
Validate at boundaries — user input, provider APIs — and trust our own code in between.

**Pause only when it matters.** Stop for a destructive or irreversible action, a real
scope change, or a decision only I can make — the name, the product calls, anything
touching the misuse disclaimer. Reversible steps that follow from what we've agreed:
just do them. Don't end a turn on "I'll now run X" — run it.

**Ground every progress claim in evidence.** Before telling me something works, point at
the tool result that shows it. If it's unverified, say so. If a test fails, show the
output. Half of this codebase's behavior can only be confirmed by running it on Windows,
which makes the temptation to assert-instead-of-check unusually high here. Resist it.

**Verify on the real thing.** There's no test suite and no linter — `renderer/` is plain
files Electron loads directly. So the only real verification is launching the app and
driving the flow. `CUE_NO_PROTECT=1` (soon renamed) makes the window visible to
recorders while debugging. Rebuilding resets nothing on Windows the way it does on
macOS, which removes one of the upstream project's biggest debugging traps.

**Lead with the outcome.** When you finish, the first sentence answers "what happened."
Detail after. Being readable matters more than being brief — drop details that don't
change what I'd do next, rather than compressing prose into fragments and arrow chains.
If you've been working a while without me watching, that summary is my first look at any
of it: re-introduce terms, don't continue your working thread.

**Keep `PROGRESS.md` current.** Last run, what's in flight, what's done, what's blocked
on me, and what you learned that isn't obvious from the code. Especially Windows
behavior discovered by running it — that knowledge is expensive and dies with the
session otherwise.
