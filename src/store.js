// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = path.join(app.getPath('userData'), 'socrates-data.json');
const LEGACY_FILE = path.join(app.getPath('userData'), 'cue-data.json'); // pre-rebrand filename

const DEFAULTS = {
  provider: 'openai',
  smart: false,
  role: 'learning',          // 'learning' | 'teaching' — swaps the whole tutoring prompt set
  onboarded: false,
  apiKeys: { openai: '', anthropic: '', gemini: '', deepgram: '' },
  models: {
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: 'claude-haiku-4-5', smart: 'claude-sonnet-5' },
    gemini: { fast: 'gemini-2.0-flash', smart: 'gemini-1.5-pro' }
  }
};

let data = null;

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

// Read the current settings file, falling back to the pre-rebrand cue-data.json so an
// existing install keeps its API keys through the rename. The old file is left in place;
// the first save() writes the new one.
function readRaw() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { /* fall through to legacy */ }
  try { return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')); }
  catch { return {}; }
}

function load() {
  if (data) return data;
  data = deepMerge(DEFAULTS, readRaw());
  return data;
}
function save() { try { fs.writeFileSync(FILE, JSON.stringify(data, null, 2)); } catch (e) { /* ignore */ } }

module.exports = {
  getSettings() { return load(); },
  setSettings(patch) { load(); data = deepMerge(data, patch || {}); save(); return data; }
};
