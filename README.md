<div align="center">

# Socrates

**An open-source teaching-and-learning copilot that floats over your screen — it sees what you see, hears your session, and helps on both sides of it: the person explaining and the person trying to understand.**

For Windows. Bring your own AI key (OpenAI · Anthropic · Google Gemini).

</div>

---

> [!IMPORTANT]
> **Please read this first.** Socrates asks Windows to keep its window out of screen recordings and shares, but this is **best-effort, not guaranteed** — and it only hides *pixels from capture*. It does **not** hide the running process or the window from the system's window list, so anything enumerating open windows or running programs can still see that Socrates is running. A phone camera pointed at the screen always sees everything. Using a hidden assistant during a **proctored exam, job interview, or recorded meeting** may break that platform's rules and, in some places, consent laws. Socrates is built for **learning and teaching** — studying, explaining, practice, accessibility. **You are responsible for how you use it.**

---

## What it is

Socrates floats a small glass panel on top of everything. It takes **three separate inputs** — your **screen**, your **microphone**, and your **session audio** (what the other person says) — and uses an AI model to help you in real time.

The thing that makes it Socrates: it helps **both sides** of a session, and it's built to **build understanding, not hand over answers**. A **Learn / Teach** toggle in the top bar swaps the whole assistant between the two roles.

### When you're **learning**

| Feature | How to trigger | What it does |
|---|---|---|
| **Explain** | `Ctrl` `↵` or the button | Looks at your screen + the session and explains the idea from the ground up so it clicks — teaching the concept, not dumping the answer. |
| **Nudge me** | `Ctrl` `H` or the button | You're stuck — it gives the *smallest* hint toward the next step, never the full solution. |
| **Check understanding** | button | Asks you pointed questions that reveal whether you really get it, and flags your likely misconception. |
| **Recap** | button | Turns the session into study notes, with a "still fuzzy" list. |
| **Ask** | type + `↵` | Any question, grounded in your screen and the session — answered to build understanding. |

### When you're **teaching**

The same buttons flip: **Explain better** (a clearer framing + an analogy + the point learners trip on), **A question to ask** (a Socratic question to guide your learner without giving it away), **Are they following?** (questions to check the learner and the point they likely missed), **What did I cover?** (coverage review + what to reinforce).

**Smart** toggle switches to a slower, more thorough model.

---

## Install

### Option A — Download the installer (easiest)

1. Go to the [**Releases**](../../releases) page and download the **`Socrates Setup <version>.exe`** installer.
2. Run it. Windows SmartScreen may warn that it's from an unknown publisher (the app isn't code-signed with a paid certificate) — click **More info → Run anyway**.
3. Pick an install location if you like, and let it create shortcuts. Launch **Socrates** from the Start menu or desktop.

### Option B — Run from source (developers)

You need [Node.js](https://nodejs.org) 18+.

```bash
git clone <your-fork-url>
cd socrates
npm install
npm start
```

To build your own installer:
```bash
npm run icons     # regenerate build/icon.ico + tray.png (only if you change the art)
npm run dist      # electron-builder --win nsis  → dist/Socrates Setup <version>.exe
```

The first `npm run dist` downloads electron-builder's Windows build tools (a few MB) and caches them.

---

## First launch — the 1-minute setup

When Socrates opens the first time, a **built-in tutorial** walks you through everything below. Reopen it anytime by clicking the **logo** (top-left of the pill). Here's the same thing in writing.

### Step 1 — Add your AI key (bring your own)

Socrates uses **your own** API key, so it's free to run (you only pay your provider for what you use). Click the **`...`** button in the input box (or press `Ctrl` `,`) to open **Settings**, pick a provider, and paste your key:

| Provider | Get a key | Notes |
|---|---|---|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | One key does everything — **but** for the *listening* features the key must have **Whisper / audio** access (a chat-only "restricted" key 403s on transcription). |
| **Anthropic (Claude)** | [console.anthropic.com](https://console.anthropic.com) | Great for the screen features. Claude has no speech-to-text, so add an OpenAI or Gemini key too if you want listening. |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | One key does chat + transcription. |

Your key is stored **only on your computer** (in `socrates-data.json` in your user data folder) and is sent **only** to that provider. Socrates has no server and collects nothing.

### Step 2 — Let it hear the session (microphone)

Windows has **no screen-recording permission** — screenshots and system/session audio just work. The **only** gate is the microphone. If listening does nothing, turn it on:

> **Settings → Privacy & security → Microphone** — make sure microphone access is on and **"Let desktop apps access your microphone"** is enabled.

### Step 3 — Know what "hidden" means

Socrates asks Windows to exclude its window from screen capture (`WDA_EXCLUDEFROMCAPTURE`), so it stays out of most shares — **Zoom, Teams, Meet, OBS** — automatically, with nothing to configure. But be clear-eyed about the boundary:

- It hides the window's **pixels** from capture APIs. ✅
- It does **not** hide the **process**, the **window handle**, or the **entry in the system's window list**. Anything that enumerates windows or running programs still sees Socrates. ❌
- A **phone camera** or a **capture card** sees the screen regardless. ❌
- On Windows builds **older than version 2004** (build 19041) the flag degrades to painting Socrates as a **black box** in captures rather than hiding it — Socrates warns you if it detects this.

"Invisible to screen capture" is the honest claim. "Undetectable" is not, and Socrates does not make it.

---

## How to use it

- **`Ctrl` `↵` — Explain / Explain better.** The do-the-smart-thing key.
- **`Ctrl` `H` — Nudge / a question.** A hint when you're stuck (learning), or a Socratic question to pose (teaching).
- **The `▢` button** (top bar) — start/stop **listening**. The green dot means it's live.
- **Learn / Teach** — flip which side of the session Socrates helps.
- **Type a question** and press `↵`.
- **Smart** — a smarter, slower model; off for fast and cheap.
- **Hide** collapses the panel to the top bar. Drag Socrates by the **top pill**.
- **Tray icon** — the overlay is hidden from the taskbar, so reach it from the **system tray** (show / hide / quit). Quit with `Ctrl` `⇧` `X`.

The panel is see-through and click-through — the empty space around it never blocks what's behind it.

---

## How it works (under the hood)

Socrates is an [Electron](https://www.electronjs.org/) app, two processes. Everything runs locally except the calls to your chosen AI provider. **No API key ever reaches the renderer** — all provider calls happen in the main process.

**The three inputs are kept completely separate:**
- **Screen** — captured with Electron's `desktopCapturer` (full-resolution screenshots, only when a feature needs one).
- **Your mic ("You")** — `getUserMedia` → 16 kHz PCM → transcribed.
- **Session audio ("Them")** — `getDisplayMedia` loopback capture (WASAPI loopback on Windows) of your system output, kept on its own channel so Socrates knows *who* said what.

Both audio streams are transcribed (OpenAI Whisper or Gemini) and fed, with an optional screenshot, to your AI model. Responses **stream** into the panel.

**The invisibility** is a single window flag: `setContentProtection(true)`, which on Windows 10 version 2004+ becomes `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`. This asks the desktop compositor to leave Socrates out of screen-capture streams. It is a real OS mechanism, not a GPU trick — and, as above, it's best-effort and hides pixels only.

```
main process ──┬─ overlay window (frameless, transparent, always-on-top, content-protected)
               ├─ tray icon (show / hide / quit — the only handle once the overlay hides)
               ├─ screenshot capture (desktopCapturer)
               ├─ speech-to-text (Whisper / Gemini)      ── "You" + "Them" channels
               └─ LLM streaming (OpenAI / Anthropic / Gemini)
renderer ──────┴─ the glass UI + mic capture + system-audio loopback
```

---

## Troubleshooting

**Listening does nothing / no transcript.** Check Settings shows a transcription-capable key (OpenAI with Whisper, or Gemini). Then check the microphone is allowed for desktop apps (Step 2).

**A feature returns "403" / "no access to model."** Your API key is restricted — most often an OpenAI project key that only allows chat. It works for the screen features but 403s on transcription. Fix: enable audio/Whisper on the key, use an unrestricted key, or add a Gemini key (Socrates falls back to it for transcription).

**Socrates shows as a black box in a share.** You're on a Windows build older than version 2004, where the hide-from-capture flag degrades. Update Windows, or run with `SOCRATES_NO_PROTECT=1` to disable the flag entirely.

**I hid the overlay and can't find it.** It's hidden from the taskbar by design — click the **Socrates tray icon** (bottom-right, near the clock) to show it again.

**Socrates shows up in my Zoom share.** Most capture paths respect the flag automatically. If Zoom still shows it, set **Zoom → Settings → Share Screen → Advanced → Screen capture mode** to *"Advanced capture with window filtering."* And remember: hiding is best-effort.

---

## Privacy

- No accounts, no servers, no telemetry. Socrates collects nothing.
- Your API keys live in a local file (`socrates-data.json`) and are sent only to the provider you chose.
- Screenshots and audio go to your AI provider only when a feature runs, and are not stored beyond the current session's transcript (kept in memory, capped).

## Contributing

Issues and PRs welcome. Socrates is intentionally **small and readable** — `main.js` (app + capture + AI), `renderer/` (the UI), `src/` (providers + prompts). No build step for the source (plain HTML/CSS/JS), and `asar` is off so a packaged app ships readable source. Please keep it that way.

## Credits & license

Forked from **cue**, an open-source macOS Cluely-style overlay, and turned into a Windows teaching/learning tool. Built as an open study of how live-assist tools work.

**License: [GPL-3.0-or-later](LICENSE).**
