const vscode = require('vscode');
const { fetchUsage } = require('./usage');
const { QuotaStatusBar } = require('./statusBar');
const { QuotaViewProvider } = require('./view');

const USAGE_PAGE = 'https://claude.ai/settings/usage';
const STALE_AFTER_MS = 60_000;

function activate(context) {
  let state = { loading: true };
  let inFlight = null;
  let timer;

  const statusBar = new QuotaStatusBar();
  const view = new QuotaViewProvider(context.extensionUri, {
    onRefresh: () => refresh(),
    onVisible: () => refreshIfStale(),
  });

  const publish = (next) => {
    state = next;
    view.update(state);
    statusBar.update(state);
  };

  const refresh = () => {
    if (inFlight) return inFlight;
    publish({ ...state, loading: true });
    inFlight = fetchUsage()
      .then((data) => publish({ data, loading: false }))
      .catch((err) =>
        publish({ data: state.data, loading: false, error: { code: err.code ?? 'unknown', message: err.message } }),
      )
      .finally(() => (inFlight = null));
    return inFlight;
  };

  const refreshIfStale = () => {
    if (Date.now() - (state.data?.fetchedAt ?? 0) > STALE_AFTER_MS) refresh();
  };

  const schedule = () => {
    clearInterval(timer);
    const minutes = Math.max(1, vscode.workspace.getConfiguration('claudeQuota').get('refreshIntervalMinutes', 5));
    timer = setInterval(refresh, minutes * 60_000);
  };

  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider('claudeQuota.view', view),
    vscode.commands.registerCommand('claudeQuota.refresh', refresh),
    vscode.commands.registerCommand('claudeQuota.openUsagePage', () =>
      vscode.env.openExternal(vscode.Uri.parse(USAGE_PAGE)),
    ),
    vscode.window.onDidChangeWindowState((s) => s.focused && refreshIfStale()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeQuota.refreshIntervalMinutes')) schedule();
      if (e.affectsConfiguration('claudeQuota.showInStatusBar')) statusBar.update(state);
    }),
    { dispose: () => clearInterval(timer) },
  );

  schedule();
  refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
