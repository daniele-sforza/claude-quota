const vscode = require('vscode');

// Contributed in package.json (defaulting to the theme's chart colors), so users can override them.
const LEVEL_COLORS = [
  [90, 'claudeQuota.statusBar.critical'],
  [75, 'claudeQuota.statusBar.high'],
  [50, 'claudeQuota.statusBar.medium'],
  [0, 'claudeQuota.statusBar.low'],
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
      this.session.backgroundColor = undefined;
      this.session.tooltip = error ? `Claude Quota: ${error.message}` : 'Loading Claude usage…';
      this.session.show();
      return;
    }

    const tooltip = buildTooltip(data, error);
    const session = data.limits.find((l) => l.group === 'session');
    const weekly = data.limits
      .filter((l) => l.group === 'weekly')
      .sort((a, b) => b.percent - a.percent)[0];

    const plain = usePlainColors();
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
      item.color = plain ? undefined : new vscode.ThemeColor(LEVEL_COLORS.find(([min]) => limit.percent >= min)[1]);
      item.backgroundColor = plain ? alertBackground(limit.percent) : undefined;
      item.tooltip = tooltip;
      item.show();
      first = false;
    }

    if (first) {
      this.session.text = '$(sparkle) Claude';
      this.session.color = undefined;
      this.session.backgroundColor = undefined;
      this.session.tooltip = tooltip;
      this.session.show();
    }
  }

  dispose() {
    this.session.dispose();
    this.weekly.dispose();
  }
}

// The bar takes another background while debugging, and the level colors can disappear against it
// (red on a red debug bar). There, and in high-contrast themes, keep the bar's own foreground and
// flag high usage with the warning/error item backgrounds instead, which every theme pairs with a
// readable foreground.
function usePlainColors() {
  const { kind } = vscode.window.activeColorTheme;
  return (
    Boolean(vscode.debug.activeDebugSession) ||
    kind === vscode.ColorThemeKind.HighContrast ||
    kind === vscode.ColorThemeKind.HighContrastLight
  );
}

function alertBackground(percent) {
  if (percent >= 90) return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (percent >= 75) return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
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
