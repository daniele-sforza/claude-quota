(() => {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  const WINDOW_MS = { session: 5 * 3_600_000, weekly: 7 * 86_400_000 };
  const ACCENTS = ['clay', 'iris', 'teal', 'gold'];
  // English labels, but the 12h/24h clock the system uses.
  const HOUR_CYCLE = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  const ERRORS = {
    'no-credentials': ['Not signed in', 'Sign in to Claude Code (run claude, then /login) and your usage will show up here.'],
    expired: ['Sign-in expired', 'Claude Code refreshes your sign-in whenever you use it. Run it once, then try again.'],
    network: ["Can't reach Claude", 'Check your connection and try again.'],
    'rate-limited': ['Too many requests', 'Give it a minute, then try again.'],
  };

  const SPARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--clay-hi)"/><stop offset="1" style="stop-color:var(--clay)"/></linearGradient></defs><path fill="url(#spark)" d="M12 1.5C12.9 7.3 16.7 11.1 22.5 12 16.7 12.9 12.9 16.7 12 22.5 11.1 16.7 7.3 12.9 1.5 12 7.3 11.1 11.1 7.3 12 1.5Z"/></svg>`;
  const REFRESH = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.45 5.17A6 6 0 1 0 14 8h-1.5a4.5 4.5 0 1 1-.8-2.57L9.75 7.38H14V3.13l-.55.55V5.17Z"/></svg>`;
  const WARN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5 15 14H1L8 1.5Zm-.75 4.5v4h1.5V6h-1.5Zm0 5.25v1.5h1.5v-1.5h-1.5Z"/></svg>`;

  let state = vscode.getState();
  let introPlayed = false;

  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'state') return;
    state = e.data.state;
    vscode.setState(state);
    render();
  });

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) vscode.postMessage({ type: el.dataset.action });
  });

  // Keeps countdowns and "updated … ago" current between fetches.
  setInterval(() => state?.data && render(), 30_000);

  render();
  vscode.postMessage({ type: 'ready' });

  function render() {
    if (!state?.data) {
      app.innerHTML = state?.error && !state.loading ? errorView(state.error) : skeleton();
      return;
    }
    app.innerHTML = dashboard(state, !introPlayed);
    introPlayed = true;
  }

  function dashboard({ data, loading, error }, intro) {
    const now = Date.now();
    const limits = data.limits.map((l, i) => ({ ...l, accent: ACCENTS[i % ACCENTS.length], pace: pace(l, now) }));
    const extra =
      data.extraUsage != null ? { label: 'Extra usage · this month', percent: data.extraUsage, accent: 'gold' } : null;

    return `
      ${header(data.plan, loading)}
      ${error ? `<div class="banner">${WARN}<span>Couldn't refresh. ${esc(error.message)} Showing data from ${ago(data.fetchedAt, now)}.</span></div>` : ''}
      ${limits.length ? hero(limits, intro) : ''}
      <section class="cards">${[...limits, ...(extra ? [extra] : [])].map((l) => card(l, intro)).join('')}</section>
      ${breakdown(data.breakdown)}
      <footer class="foot">
        <span>Updated ${ago(data.fetchedAt, now)}</span>
        <button class="link" data-action="openUsage">claude.ai usage ↗</button>
      </footer>`;
  }

  function header(plan, loading) {
    return `
      <header class="top">
        <div class="brand">${SPARK}<span>Claude usage</span>${plan ? `<span class="plan">${esc(plan)}</span>` : ''}</div>
        <button class="icon-btn ${loading ? 'spinning' : ''}" data-action="refresh" title="Refresh" aria-label="Refresh">${REFRESH}</button>
      </header>`;
  }

  function hero(limits, intro) {
    const size = 184;
    const stroke = 13;
    const gap = 5;
    const c = size / 2;
    const rings = limits.slice(0, 3);
    const peak = limits.reduce((a, b) => (b.percent > a.percent ? b : a));

    const defs = rings
      .map(
        (l) =>
          `<linearGradient id="g-${l.accent}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--${l.accent}-hi)"/><stop offset="1" style="stop-color:var(--${l.accent})"/></linearGradient>`,
      )
      .join('');
    const circles = rings
      .map((l, i) => {
        const r = c - stroke / 2 - i * (stroke + gap);
        const len = 2 * Math.PI * r;
        const offset = len * (1 - clamp(l.percent, 0, 100) / 100);
        return `
          <circle class="track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}" style="stroke:var(--${l.accent})"/>
          <circle class="arc ${intro ? 'intro' : ''}" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"
            stroke-dasharray="${len}" stroke-dashoffset="${offset}"
            style="stroke:url(#g-${l.accent}); --len:${len}; --glow:var(--${l.accent}); animation-delay:${i * 90}ms"/>`;
      })
      .join('');

    return `
      <section class="hero" aria-label="${esc(peak.label)}: ${Math.round(peak.percent)}% used">
        <svg class="rings" viewBox="0 0 ${size} ${size}"><defs>${defs}</defs>${circles}</svg>
        <div class="hero-center">
          <div class="hero-pct">${Math.round(peak.percent)}<small>%</small></div>
          <div class="hero-label">${esc(peak.group === 'session' ? 'Session' : peak.kind === 'weekly_all' ? 'This week' : peak.label)}</div>
        </div>
      </section>`;
  }

  function card(l, intro) {
    const level = l.percent >= 90 ? 'crit' : l.percent >= 75 ? 'warn' : '';
    const p = l.pace;
    return `
      <article class="card">
        <div class="card-head">
          <span class="dot" style="--c:var(--${l.accent})"></span>
          <span class="card-title">${esc(l.label)}</span>
          ${level ? `<span class="chip ${level}">${l.percent >= 100 ? 'Limit reached' : 'Near limit'}</span>` : ''}
        </div>
        <div class="card-main">
          <span class="pct">${Math.round(l.percent)}<small>%</small></span>
          ${l.resetsAt ? `<span class="reset" title="${esc(absTime(l.resetsAt))}">${resetText(l.resetsAt)}</span>` : ''}
        </div>
        <div class="bar">
          <div class="fill ${intro ? 'intro' : ''}" style="width:${clamp(l.percent, 0, 100)}%; --c:var(--${l.accent}); --c-hi:var(--${l.accent}-hi)"></div>
          ${p ? `<div class="marker" style="left:${p.elapsed * 100}%" title="${Math.round(p.elapsed * 100)}% of this window has passed"></div>` : ''}
        </div>
        ${p?.text ? `<div class="pace ${p.tone}">${esc(p.text)}</div>` : ''}
      </article>`;
  }

  function breakdown(rows) {
    if (!rows?.length) return '';
    const shade = (i) => `color-mix(in srgb, var(--clay) ${Math.max(100 - i * 28, 22)}%, var(--bg))`;
    return `
      <section class="section">
        <h2>This week by surface</h2>
        <div class="stack">${rows.map((r, i) => `<span style="flex:${r.percent}; background:${shade(i)}" title="${esc(r.name)} · ${r.percent}%"></span>`).join('')}</div>
        <ul class="legend">
          ${rows.map((r, i) => `<li><span class="dot" style="--c:${shade(i)}"></span><span class="name">${esc(r.name)}</span><span class="num">${r.percent}%</span></li>`).join('')}
        </ul>
      </section>`;
  }

  function skeleton() {
    return `
      ${header(null, true)}
      <section class="hero"><div class="sk sk-ring"></div></section>
      <div class="sk sk-card"></div>
      <div class="sk sk-card"></div>`;
  }

  function errorView(error) {
    const [title, body] = ERRORS[error.code] ?? ['Something went wrong', error.message];
    return `
      <div class="empty">
        ${SPARK}
        <h1>${esc(title)}</h1>
        <p>${esc(body)}</p>
        <button class="btn" data-action="refresh">Try again</button>
      </div>`;
  }

  // Projects the current burn rate across the rest of the window.
  function pace(l, now) {
    const windowMs = WINDOW_MS[l.group];
    if (!windowMs || !l.resetsAt) return null;
    const remaining = Date.parse(l.resetsAt) - now;
    const elapsedMs = windowMs - remaining;
    const elapsed = clamp(elapsedMs / windowMs, 0, 1);

    if (l.percent >= 100) return { elapsed, tone: 'crit', text: 'Limit reached until the window resets' };
    if (elapsed < 0.05 || l.percent <= 0) return { elapsed };
    const msToLimit = ((100 - l.percent) / l.percent) * elapsedMs;
    if (msToLimit < remaining) {
      return { elapsed, tone: 'warn', text: `At this pace you'll hit the limit in ${duration(msToLimit)}` };
    }
    return { elapsed, tone: 'ok', text: `On track · about ${Math.round(l.percent / elapsed)}% by reset` };
  }

  function resetText(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (ms <= 0) return 'Resetting…';
    if (ms < 86_400_000) return `Resets in ${duration(ms)}`;
    return `Resets ${new Date(iso).toLocaleString('en', { weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: HOUR_CYCLE })}`;
  }

  function absTime(iso) {
    return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', hourCycle: HOUR_CYCLE });
  }

  function ago(ts, now) {
    return now - ts < 60_000 ? 'just now' : `${duration(now - ts)} ago`;
  }

  function duration(ms) {
    const minutes = Math.round(ms / 60_000);
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${Math.max(m, 1)}m`;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  }
})();
