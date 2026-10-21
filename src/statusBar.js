const vscode = require('vscode');

class QuotaStatusBar {
  constructor() {
    this.item = vscode.window.createStatusBarItem('claudeQuota.status', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Claude Quota';
    this.item.command = 'claudeQuota.view.focus';
  }

  update(state) {
    if (!vscode.workspace.getConfiguration('claudeQuota').get('showInStatusBar', true)) {
      this.item.hide();
      return;
    }

    const { data, error } = state;
    this.item.backgroundColor = undefined;

    if (!data) {
      this.item.text = error ? '$(sparkle) Claude —' : '$(sync~spin) Claude';
      this.item.tooltip = error ? `Claude Quota: ${error.message}` : 'Loading Claude usage…';
      this.item.show();
      return;
    }

    const session = data.limits.find((l) => l.group === 'session');
    const weekly = data.limits
      .filter((l) => l.group === 'weekly')
      .sort((a, b) => b.percent - a.percent)[0];
    const parts = [session && `5h ${Math.round(session.percent)}%`, weekly && `7d ${Math.round(weekly.percent)}%`];
    this.item.text = `$(sparkle) ${parts.filter(Boolean).join(' · ') || 'Claude'}`;

    const peak = Math.max(0, ...data.limits.map((l) => l.percent));
    if (peak >= 90) this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    else if (peak >= 75) this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Claude${data.plan ? ` ${data.plan}` : ''}** usage\n\n`);
    tooltip.appendMarkdown('| | Used | Resets |\n|:--|--:|:--|\n');
    for (const l of data.limits) {
      tooltip.appendMarkdown(`| ${l.label} | ${Math.round(l.percent)}% | ${formatReset(l.resetsAt)} |\n`);
    }
    if (error) tooltip.appendMarkdown(`\n$(warning) Last refresh failed: ${error.message}`);
    tooltip.supportThemeIcons = true;
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose() {
    this.item.dispose();
  }
}

function formatReset(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${m}m`;
  return `in ${Math.max(m, 1)}m`;
}

module.exports = { QuotaStatusBar };
