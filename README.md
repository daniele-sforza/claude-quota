# Claude Quota

See your Claude plan usage limits without leaving VS Code.

- **Sidebar dashboard**: rings for your session and weekly limits, a card per limit with its reset countdown, a pace marker showing how much of the window has passed, and a projection of whether you'll hit the limit before it resets.
- **Breakdown** of where this week's usage went (Claude Code, chats, and so on).
- **Status bar** item (`5h 12% · 7d 40%`) that turns amber at 75% and red at 90%. Click it to open the dashboard.

## How it works

The extension reads the sign-in that Claude Code already stores on your machine (the macOS Keychain, or `~/.claude/.credentials.json` on Linux and Windows) and calls the same usage endpoint that Claude Code's `/usage` command reads. It never writes or refreshes your credentials. If the token has expired, run Claude Code once and it will refresh it.

## Settings

| Setting | Default | |
|:--|:--|:--|
| `claudeQuota.refreshIntervalMinutes` | `5` | How often to refresh. |
| `claudeQuota.showInStatusBar` | `true` | Show the status bar item. |

It also refreshes when the window regains focus or the panel opens, if the data is more than a minute old.

## License

[MIT](LICENSE)
