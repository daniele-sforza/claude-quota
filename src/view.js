const crypto = require('crypto');
const vscode = require('vscode');

class QuotaViewProvider {
  constructor(extensionUri, { onRefresh, onVisible }) {
    this.extensionUri = extensionUri;
    this.onRefresh = onRefresh;
    this.onVisible = onVisible;
    this.state = { loading: true };
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [media] };
    webviewView.webview.html = this.html(webviewView.webview, media);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') this.post();
      else if (msg.type === 'refresh') this.onRefresh();
      else if (msg.type === 'openUsage') vscode.commands.executeCommand('claudeQuota.openUsagePage');
    });
    webviewView.onDidChangeVisibility(() => webviewView.visible && this.onVisible());
    webviewView.onDidDispose(() => (this.view = undefined));
  }

  get visible() {
    return Boolean(this.view?.visible);
  }

  update(state) {
    this.state = state;
    this.post();
  }

  post() {
    this.view?.webview.postMessage({ type: 'state', state: this.state });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'view.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'view.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
</head>
<body>
  <main id="app"></main>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

module.exports = { QuotaViewProvider };
