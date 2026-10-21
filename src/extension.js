const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { fetchUsage } = require('./usage');
const { QuotaStatusBar } = require('./statusBar');
const { QuotaViewProvider } = require('./view');

const USAGE_PAGE = 'https://claude.ai/settings/usage';
const MANUAL_REFRESH_GAP_MS = 60_000;
const BACKOFF_MINUTES = [2, 5, 10, 15];

function activate(context) {
  const cache = new SharedCache(context.globalStorageUri.fsPath);
  let state = { loading: true };
  let inFlight = null;
  let timer;

  const statusBar = new QuotaStatusBar();
  const view = new QuotaViewProvider(context.extensionUri, {
    onRefresh: () => refresh(true),
    onVisible: () => refresh(false),
  });

  const publish = (next) => {
    state = next;
    view.update(state);
    statusBar.update(state);
  };

  const intervalMs = () =>
    Math.max(1, vscode.workspace.getConfiguration('claudeQuota').get('refreshIntervalMinutes', 5)) * 60_000;

  const refresh = (manual = false) => {
    if (inFlight) return inFlight;
    inFlight = sync(manual).finally(() => (inFlight = null));
    return inFlight;
  };

  // Every window reads the same cache and only fetches once it is due, so all open windows
  // together make about one request per interval instead of one each.
  const sync = async (manual) => {
    const cached = await cache.read();
    const now = Date.now();
    const minGapMs = manual ? (cached.error ? 0 : MANUAL_REFRESH_GAP_MS) : intervalMs() * 0.9;
    if (now < (cached.blockedUntil ?? 0) || now - (cached.attemptAt ?? 0) < minGapMs) {
      publish({ data: cached.data ?? state.data, error: cached.error, loading: false });
      return;
    }

    publish({ ...state, loading: true });
    try {
      const data = await fetchUsage();
      await cache.write({ data, attemptAt: now });
      publish({ data, loading: false });
    } catch (err) {
      const entry = {
        data: cached.data ?? state.data,
        error: { code: err.code ?? 'unknown', message: err.message },
        attemptAt: now,
      };
      if (err.code === 'rate-limited') {
        entry.failures = (cached.failures ?? 0) + 1;
        const backoffMs = BACKOFF_MINUTES[Math.min(entry.failures, BACKOFF_MINUTES.length) - 1] * 60_000;
        const waitMs = Math.max(backoffMs, err.retryAfterMs ?? 0);
        entry.blockedUntil = now + waitMs;
        entry.error.message = `Claude is limiting how often usage can be checked. Trying again in ${Math.round(waitMs / 60_000)}m.`;
      }
      await cache.write(entry);
      publish({ data: entry.data, error: entry.error, loading: false });
    }
  };

  const schedule = () => {
    clearInterval(timer);
    timer = setInterval(() => refresh(false), intervalMs());
  };

  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider('claudeQuota.view', view),
    vscode.commands.registerCommand('claudeQuota.refresh', () => refresh(true)),
    vscode.commands.registerCommand('claudeQuota.toggle', () =>
      vscode.commands.executeCommand(view.visible ? 'workbench.action.closeSidebar' : 'claudeQuota.view.focus'),
    ),
    vscode.commands.registerCommand('claudeQuota.openUsagePage', () =>
      vscode.env.openExternal(vscode.Uri.parse(USAGE_PAGE)),
    ),
    vscode.window.onDidChangeWindowState((s) => s.focused && refresh(false)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeQuota.refreshIntervalMinutes')) schedule();
      if (e.affectsConfiguration('claudeQuota.showInStatusBar')) statusBar.update(state);
    }),
    { dispose: () => clearInterval(timer) },
  );

  schedule();
  refresh(false);
}

// Global storage is shared by every VS Code window. Holds usage numbers only, never credentials.
class SharedCache {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'usage.json');
  }

  async read() {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  async write(entry) {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(entry));
      await fs.rename(tmp, this.file);
    } catch {
      // The cache only saves requests; carry on without it.
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
