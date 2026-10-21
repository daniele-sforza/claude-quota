const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

// Same endpoint Claude Code's /usage command reads, authenticated with Claude Code's own sign-in.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

const LIMIT_LABELS = {
  session: 'Current session',
  weekly_all: 'Weekly · All models',
  weekly_opus: 'Weekly · Opus',
  weekly_sonnet: 'Weekly · Sonnet',
};

// Responses without a `limits` array only carry these per-window fields.
const LEGACY_WINDOWS = [
  ['five_hour', 'session', 'session'],
  ['seven_day', 'weekly_all', 'weekly'],
  ['seven_day_opus', 'weekly_opus', 'weekly'],
  ['seven_day_sonnet', 'weekly_sonnet', 'weekly'],
];

class QuotaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readKeychain() {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    );
  });
}

async function readCredentials() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const sources = [() => fs.readFile(path.join(configDir, '.credentials.json'), 'utf8')];
  if (process.platform === 'darwin') sources.unshift(readKeychain);

  for (const read of sources) {
    try {
      const oauth = JSON.parse(await read()).claudeAiOauth;
      if (oauth?.accessToken) return oauth;
    } catch {
      // Fall through to the next source.
    }
  }
  throw new QuotaError('no-credentials', 'Sign in to Claude Code to see your quota.');
}

async function fetchUsage() {
  const oauth = await readCredentials();

  let res;
  try {
    res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new QuotaError('network', `Couldn't reach Claude (${err.message}).`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new QuotaError('expired', 'Your Claude Code sign-in has expired.');
  }
  if (res.status === 429) throw new QuotaError('rate-limited', 'Too many requests. Try again in a minute.');
  if (!res.ok) throw new QuotaError('http', `Claude returned HTTP ${res.status}.`);

  return normalize(await res.json(), oauth);
}

function normalize(raw, oauth) {
  let limits = (raw.limits ?? []).map((l) => ({
    kind: l.kind,
    group: l.group,
    label: labelFor(l.kind),
    percent: l.percent ?? 0,
    resetsAt: l.resets_at,
  }));
  if (!limits.length) {
    limits = LEGACY_WINDOWS.filter(([key]) => raw[key]).map(([key, kind, group]) => ({
      kind,
      group,
      label: labelFor(kind),
      percent: raw[key].utilization ?? 0,
      resetsAt: raw[key].resets_at,
    }));
  }

  const extra = raw.extra_usage;
  return {
    plan: planName(oauth),
    limits,
    breakdown: (raw.seven_day_breakdown?.rows ?? [])
      .filter((r) => r.percent > 0)
      .map((r) => ({ name: r.display_name, percent: r.percent })),
    extraUsage: extra?.is_enabled && extra.utilization != null ? extra.utilization : null,
    fetchedAt: Date.now(),
  };
}

function labelFor(kind) {
  return LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function planName({ subscriptionType, rateLimitTier }) {
  if (!subscriptionType) return null;
  const name = subscriptionType[0].toUpperCase() + subscriptionType.slice(1);
  const multiplier = /(\d+x)/.exec(rateLimitTier ?? '')?.[1];
  return multiplier ? `${name} ${multiplier}` : name;
}

module.exports = { fetchUsage };
