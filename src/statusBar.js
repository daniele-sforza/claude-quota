const vscode = require('vscode');

// Theme chart colors, so the values stay readable in light and dark themes.
const LEVEL_COLORS = [
  [90, 'charts.red'],
  [75, 'charts.orange'],
  [50, 'charts.yellow'],
  [0, 'charts.green'],
];

class QuotaStatusBar {
  constructor() {
    // VS Code colors a whole item at once, so each value gets its own item. Items are ordered by
    // priority across all extensions; adjacent fractional values keep anything from landing between.
    this.session = createItem('claudeQuota.session', 'Claude Quota: Session', 100.00002);
    this.weekly = createItem('claudeQuota.weekly', 'Claude Quota: Weekly', 100.00001);
  }

  update(state) {
    if (!vscode.workspace.getConfiguration('claudeQuota').get('showInStatusBar', true)) {
      this.session.hide();
      this.weekly.hide();
      return;
    }

    const { data, error } = state;
    if (!data) {
      this.weekly.hide();
      this.session.text = error ? '$(sparkle) Claude —' : '$(sync~spin) Claude';
      this.session.color = undefined;
      this.session.tooltip = error ? `Claude Quota: ${error.message}` : 'Loading Claude usage…';
      this.session.show();
      return;
    }

    const tooltip = buildTooltip(data, error);
    const session = data.limits.find((l) => l.group === 'session');
    const weekly = data.limits
      .filter((l) => l.group === 'weekly')
      .sort((a, b) => b.percent - a.percent)[0];

    let first = true;
    for (const [item, limit, prefix] of [
      [this.session, session, '5h'],
      [this.weekly, weekly, '7d'],
    ]) {
      if (!limit) {
        item.hide();
        continue;
      }
      item.text = `${first ? '$(sparkle) ' : ''}${prefix} ${Math.round(limit.percent)}%`;
      item.color = new vscode.ThemeColor(LEVEL_COLORS.find(([min]) => limit.percent >= min)[1]);
      item.tooltip = tooltip;
      item.show();
      first = false;
    }

    if (first) {
      this.session.text = '$(sparkle) Claude';
      this.session.color = undefined;
      this.session.tooltip = tooltip;
      this.session.show();
    }
  }

  dispose() {
    this.session.dispose();
    this.weekly.dispose();
  }
}

function createItem(id, name, priority) {
  const item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Right, priority);
  item.name = name;
  item.command = 'claudeQuota.toggle';
  return item;
}

function buildTooltip(data, error) {
  const tooltip = new vscode.MarkdownString();
  tooltip.supportThemeIcons = true;
  tooltip.appendMarkdown(`**Claude${data.plan ? ` ${data.plan}` : ''}** usage\n\n`);
  tooltip.appendMarkdown('| | Used | Resets |\n|:--|--:|:--|\n');
  for (const l of data.limits) {
    tooltip.appendMarkdown(`| ${l.label} | ${Math.round(l.percent)}% | ${formatReset(l.resetsAt)} |\n`);
  }
  if (error) tooltip.appendMarkdown(`\n$(warning) Last refresh failed: ${error.message}`);
  return tooltip;
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
