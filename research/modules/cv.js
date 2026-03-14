/**
 * cv.js — User profile loader
 * Loads candidate profile from config/user-profile.json
 * Copy config/user-profile.example.json to config/user-profile.json and fill in your details
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../../config/user-profile.json');

let _profile = null;

function loadProfile() {
  if (_profile) return _profile;
  try {
    const raw = readFileSync(configPath, 'utf8');
    _profile = JSON.parse(raw);
    return _profile;
  } catch (err) {
    console.error('[cv] Cannot load config/user-profile.json:', err.message);
    console.error('[cv] Copy config/user-profile.example.json to config/user-profile.json and fill in your details');
    process.exit(1);
  }
}

export const CV = loadProfile();

export function formatProofPoints() {
  const profile = loadProfile();
  return (profile.proofPoints || [])
    .map(p => `- ${p.company} (${p.role}): ${p.highlight}${p.note ? ' — ' + p.note : ''}`)
    .join('\n');
}

export function getPositioningContext() {
  const p = loadProfile();
  return `${p.name}, ${p.title} with ${p.yearsExperience} years experience. ${p.positioning}`;
}
