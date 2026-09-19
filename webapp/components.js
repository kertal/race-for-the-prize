(function () {
'use strict';

const RACER_COLORS = ['#60a5fa', '#f87171', '#4ade80', '#a78bfa', '#fb923c'];

// --- Shared helpers ---

function formatRaceName(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatResultDir(dir) {
  const m = dir.match(/^results-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : dir;
}

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Clone a <template> by id and return its shadow-ready content. */
function cloneTemplate(id) {
  return document.getElementById(id).content.cloneNode(true);
}

/** Create a CSSStyleSheet from a CSS string. */
function createStyleSheet(css) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

// --- Component stylesheets ---

const appStyles = createStyleSheet(`
  :host { display: block; }
  .header {
    padding: 24px 32px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .header h1 {
    font-size: 20px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text);
    background: none;
    border: none;
    font-family: inherit;
    padding: 0;
  }
  .header h1:hover { color: var(--accent); }
  .header h1:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
    font-size: 14px;
  }
  .breadcrumb a { color: var(--text-dim); text-decoration: none; cursor: pointer; }
  .breadcrumb a:hover { color: var(--text); }
  .breadcrumb .sep { color: var(--border); }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px 32px; }
  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-dim);
  }
  .empty-state .icon { font-size: 48px; margin-bottom: 16px; }
  .empty-state p { font-size: 15px; }
  .race-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 16px;
  }
  @media (max-width: 600px) {
    .header { padding: 16px; }
    .container { padding: 16px; }
    .race-grid { grid-template-columns: 1fr; }
  }
`);

const raceCardStyles = createStyleSheet(`
  :host { display: block; cursor: pointer; }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    transition: all 0.15s;
  }
  .card:hover, .card:focus {
    background: var(--bg-hover);
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .card:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: var(--text); }
  .racers { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .tags { display: flex; gap: 8px; flex-wrap: wrap; }
  .tag {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }
  .tag-racer { background: #1e3a5f; color: var(--blue); }
  .tag-results { background: #1a2e1a; color: var(--green); font-size: 11px; }
  .tag-setting { background: #2d2318; color: var(--orange); font-size: 11px; }
`);

const raceDetailStyles = createStyleSheet(`
  :host { display: block; }
  .detail-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px; flex-wrap: wrap; gap: 12px;
  }
  .detail-header h2 { font-size: 24px; color: var(--text); }
  .btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 18px; border: 1px solid var(--accent);
    border-radius: 8px; background: var(--accent); color: #000;
    font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .btn-primary:hover { background: #e6b430; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .settings-panel {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;
  }
  .settings-panel h4 {
    font-size: 13px; color: var(--text-dim); text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .settings-grid { display: flex; gap: 16px; flex-wrap: wrap; }
  .setting-item { font-size: 13px; }
  .setting-item .key { color: var(--text-dim); }
  .setting-item .val { color: var(--text); font-weight: 500; }
  .results-heading {
    font-size: 16px; margin-bottom: 16px; color: var(--text-dim);
  }
  .empty-state {
    text-align: center; padding: 48px 24px; color: var(--text-dim);
  }
  .empty-state .icon { font-size: 48px; margin-bottom: 16px; }
  .empty-state p { font-size: 15px; }
  @media (max-width: 600px) {
    .detail-header { flex-direction: column; align-items: flex-start; }
  }
`);

const runControlsStyles = createStyleSheet(`
  :host { display: block; margin-bottom: 16px; }
  .run-options {
    display: flex; gap: 12px; flex-wrap: wrap;
    align-items: center; margin-bottom: 16px;
  }
  label {
    display: flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--text-dim); cursor: pointer;
  }
  input[type="checkbox"] { accent-color: var(--accent); }
  input[type="number"], select {
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); padding: 4px 8px; border-radius: 6px;
    font-size: 13px; width: 80px;
  }
  .status { display: none; }
  .status.visible {
    display: block;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;
  }
  .status-line {
    display: flex; align-items: center; gap: 8px; font-size: 14px;
    color: var(--text);
  }
  .spinner {
    display: inline-block; width: 16px; height: 16px;
    border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .output {
    display: none; margin-top: 12px; background: var(--bg);
    border-radius: 8px; padding: 12px; max-height: 200px;
    overflow-y: auto; font-family: 'SF Mono', monospace;
    font-size: 12px; line-height: 1.5; color: var(--text-dim);
    white-space: pre-wrap; word-break: break-all;
  }
  .output.visible { display: block; }
`);

const scriptViewerStyles = createStyleSheet(`
  :host { display: block; margin-bottom: 32px; }
  h3 { font-size: 16px; margin-bottom: 12px; color: var(--text-dim); }
  .tabs { display: flex; gap: 4px; }
  .tabs[role="tablist"] button {
    padding: 6px 16px; background: var(--bg); border: 1px solid var(--border);
    border-bottom: none; border-radius: 8px 8px 0 0; color: var(--text-dim);
    cursor: pointer; font-size: 13px; font-family: inherit;
  }
  .tabs[role="tablist"] button[aria-selected="true"] {
    background: var(--bg-card); color: var(--text);
  }
  .content {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 0 8px 8px 8px; padding: 16px; overflow-x: auto;
  }
  pre {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px; line-height: 1.6; white-space: pre; color: var(--text);
    display: none;
  }
  pre.active { display: block; }
`);

const resultCardStyles = createStyleSheet(`
  :host { display: block; margin-bottom: 12px; }
  .card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden;
  }
  .header {
    padding: 16px 20px; cursor: pointer; display: flex;
    align-items: center; justify-content: space-between;
    transition: background 0.15s; width: 100%; background: transparent;
    border: none; font-family: inherit; text-align: left;
  }
  .header:hover, .header:focus { background: var(--bg-hover); }
  .header:focus {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .timestamp { font-weight: 500; color: var(--text); }
  .winner {
    display: flex; align-items: center; gap: 6px;
    font-size: 14px; color: var(--text);
  }
  .winner .no-winner { color: var(--text-dim); }
  .body {
    display: none; padding: 0 20px 20px;
    border-top: 1px solid var(--border);
  }
  .body.open { display: block; padding-top: 16px; }
  .videos-heading {
    font-size: 13px; color: var(--text-dim); text-transform: uppercase;
    letter-spacing: 0.05em; margin: 20px 0 12px;
  }
  .video-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .video-item { background: var(--bg); border-radius: 8px; overflow: hidden; }
  .video-item video { width: 100%; display: block; }
  .video-label { padding: 8px 12px; font-size: 13px; font-weight: 500; color: var(--text); }
  .machine-info { margin-top: 16px; font-size: 12px; color: var(--text-dim); }
  .machine-info span { margin-right: 16px; }
  .raw-section { margin-top: 16px; }
  .raw-toggle {
    font-size: 13px; color: var(--text-dim); cursor: pointer; user-select: none;
    background: transparent; border: none; padding: 4px; font-family: inherit;
    text-align: left;
  }
  .raw-toggle:hover, .raw-toggle:focus { color: var(--text); }
  .raw-toggle:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .raw-content {
    display: none; margin-top: 8px; background: var(--bg);
    border-radius: 8px; padding: 16px; overflow-x: auto;
    max-height: 400px; overflow-y: auto;
  }
  .raw-content.open { display: block; }
  .raw-content pre {
    font-family: 'SF Mono', monospace; font-size: 12px;
    line-height: 1.5; color: var(--text-dim);
  }
`);

const comparisonChartStyles = createStyleSheet(`
  :host { display: block; margin-bottom: 20px; }
  .comp-name { font-size: 13px; color: var(--text-dim); margin-bottom: 8px; }
  .bar-row {
    display: flex; align-items: center; gap: 12px; margin-bottom: 4px;
  }
  .bar-label {
    width: 100px; font-size: 13px; font-weight: 500; text-align: right;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bar-track {
    flex: 1; height: 24px; background: var(--bg);
    border-radius: 4px; overflow: hidden;
  }
  .bar-fill {
    height: 100%; border-radius: 4px;
    transition: width 0.3s ease; min-width: 2px;
  }
  .bar-value {
    width: 80px; font-size: 13px;
    font-family: 'SF Mono', monospace; text-align: right;
    color: var(--text);
  }
  .bar-badge { font-size: 14px; width: 24px; text-align: center; }
`);

const liveViewStyles = createStyleSheet(`
  :host { display: block; margin-bottom: 24px; }
  .live-container {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 20px; overflow: hidden;
  }
  .live-header {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px; font-size: 14px; color: var(--text);
  }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--red); animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .live-header.stopped .live-dot { background: var(--text-dim); animation: none; }
  .frames {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  .frame-item {
    background: var(--bg); border-radius: 8px; overflow: hidden;
    position: relative;
  }
  .frame-item img {
    width: 100%; display: block; aspect-ratio: 16/9;
    object-fit: contain; background: #000;
  }
  .frame-item .placeholder {
    width: 100%; aspect-ratio: 16/9;
    display: flex; align-items: center; justify-content: center;
    background: #000; color: var(--text-dim); font-size: 13px;
  }
  .frame-label {
    padding: 6px 10px; font-size: 13px; font-weight: 500;
    color: var(--text); display: flex; align-items: center; gap: 6px;
  }
  .frame-label .color-dot {
    width: 8px; height: 8px; border-radius: 50%;
  }
`);

// --- <race-app> ---
// Fix #9: store popstate handler ref for cleanup in disconnectedCallback
// Fix #13: h1 is a button for keyboard access

class RaceApp extends HTMLElement {
  #view = 'list';
  #race = null;
  #pollingTimer = null;
  #popstateHandler = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [appStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-app'));
  }

  connectedCallback() {
    const h1 = this.shadowRoot.querySelector('h1');
    h1.tabIndex = 0;
    h1.setAttribute('role', 'button');
    h1.addEventListener('click', () => this.navigate('list'));
    h1.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.navigate('list');
      }
    });

    this.#popstateHandler = (e) => {
      if (e.state) { this.#view = e.state.view; this.#race = e.state.race; }
      else { this.#view = 'list'; this.#race = null; }
      this.#render();
    };
    window.addEventListener('popstate', this.#popstateHandler);

    // Listen for navigation events from child components
    this.addEventListener('navigate-race', (e) => this.navigate('detail', e.detail.name));
    this.addEventListener('race-completed', () => {
      if (this.#race) this.navigate('detail', this.#race);
    });

    // Init from hash
    if (window.location.hash) {
      this.#view = 'detail';
      this.#race = decodeURIComponent(window.location.hash.slice(1));
    }
    this.#render();
  }

  disconnectedCallback() {
    if (this.#popstateHandler) {
      window.removeEventListener('popstate', this.#popstateHandler);
      this.#popstateHandler = null;
    }
    this.clearPolling();
  }

  navigate(view, race = null) {
    this.#view = view;
    this.#race = race;
    this.clearPolling();
    this.#render();
    const url = view === 'list' ? '/' : `#${encodeURIComponent(race)}`;
    window.history.pushState({ view, race }, '', url);
  }

  clearPolling() {
    if (this.#pollingTimer) { clearInterval(this.#pollingTimer); this.#pollingTimer = null; }
  }

  set pollingTimer(t) { this.#pollingTimer = t; }
  get pollingTimer() { return this.#pollingTimer; }

  async #render() {
    const grid = this.shadowRoot.querySelector('.race-grid');
    const empty = this.shadowRoot.querySelector('.empty-state');
    const breadcrumb = this.shadowRoot.querySelector('.breadcrumb');

    // Clear slotted children
    this.textContent = '';
    grid.hidden = true;
    empty.hidden = true;

    try {
      if (this.#view === 'list') {
        breadcrumb.textContent = '';
        const data = await api('races');
        this.#renderList(grid, empty, data.races);
      } else if (this.#view === 'detail' && this.#race) {
        this.#renderBreadcrumb(breadcrumb);
        const data = await api(`races/${encodeURIComponent(this.#race)}`);
        this.#renderDetail(data);
      }
    } catch (err) {
      empty.hidden = false;
      empty.querySelector('.icon').textContent = '\u26A0';
      empty.querySelector('p').textContent = err.message;
    }
  }

  #renderBreadcrumb(nav) {
    nav.textContent = '';
    const link = document.createElement('a');
    link.textContent = 'Races';
    link.addEventListener('click', (e) => { e.preventDefault(); this.navigate('list'); });
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
    const current = document.createElement('span');
    current.textContent = this.#race;
    nav.append(link, sep, current);
  }

  #renderList(grid, empty, races) {
    if (!races || races.length === 0) {
      empty.hidden = false;
      empty.querySelector('.icon').textContent = '\uD83C\uDFCE';
      empty.querySelector('p').textContent = 'No races found in the races/ directory.';
      return;
    }
    grid.hidden = false;
    grid.textContent = '';
    for (const race of races) {
      const card = document.createElement('race-card');
      card.data = race;
      grid.appendChild(card);
    }
  }

  #renderDetail(data) {
    const detail = document.createElement('race-detail');
    detail.data = data;
    this.appendChild(detail);
  }
}

// --- <race-card> ---
// Fix #8: guard against duplicate listeners with #bound flag

class RaceCard extends HTMLElement {
  #bound = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [raceCardStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-race-card'));
  }

  set data(race) {
    this.shadowRoot.querySelector('h3').textContent = formatRaceName(race.name);

    const racersEl = this.shadowRoot.querySelector('.racers');
    racersEl.textContent = '';
    for (const name of race.racerNames) {
      const tag = document.createElement('span');
      tag.className = 'tag tag-racer';
      tag.textContent = name;
      racersEl.appendChild(tag);
    }

    const tagsEl = this.shadowRoot.querySelector('.tags');
    tagsEl.textContent = '';
    if (race.settings) {
      for (const [k, v] of Object.entries(race.settings)) {
        const tag = document.createElement('span');
        tag.className = 'tag tag-setting';
        tag.textContent = `${k}: ${v}`;
        tagsEl.appendChild(tag);
      }
    }
    if (race.resultCount > 0) {
      const tag = document.createElement('span');
      tag.className = 'tag tag-results';
      tag.textContent = `${race.resultCount} result${race.resultCount !== 1 ? 's' : ''}`;
      tagsEl.appendChild(tag);
    }

    if (!this.#bound) {
      this.#bound = true;
      const card = this.shadowRoot.querySelector('.card');
      const handleActivate = () => {
        this.dispatchEvent(new CustomEvent('navigate-race', {
          bubbles: true, composed: true,
          detail: { name: race.name },
        }));
      };
      card.addEventListener('click', handleActivate);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      });
    }
  }
}

// --- <race-detail> ---
// Fix #8: guard against duplicate listeners
// Fix #10: disconnectedCallback cleans up polling timer
// Fix #11: #controls instead of _controls

class RaceDetail extends HTMLElement {
  #raceName = '';
  #controls = null;
  #pollTimer = null;
  #bound = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [raceDetailStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-race-detail'));
  }

  disconnectedCallback() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    const app = document.querySelector('race-app');
    if (app && app.pollingTimer === this.#pollTimer) {
      app.pollingTimer = null;
    }
  }

  set data(data) {
    this.#raceName = data.name;
    const root = this.shadowRoot;

    // Title
    root.querySelector('h2').textContent = formatRaceName(data.name);

    // Run button — bind only once
    if (!this.#bound) {
      this.#bound = true;
      const btn = root.querySelector('.btn-primary');
      btn.addEventListener('click', () => this.#triggerRun(btn));
    }

    // Run controls
    if (!this.#controls) {
      const controls = document.createElement('run-controls');
      controls.slot = 'run-controls';
      this.appendChild(controls);
      this.#controls = controls;
    }

    // Settings
    if (data.settings && Object.keys(data.settings).length > 0) {
      const panel = root.querySelector('.settings-panel');
      panel.hidden = false;
      const grid = panel.querySelector('.settings-grid');
      grid.textContent = '';
      for (const [k, v] of Object.entries(data.settings)) {
        const item = document.createElement('div');
        item.className = 'setting-item';
        const keyEl = document.createElement('span');
        keyEl.className = 'key';
        keyEl.textContent = `${k}: `;
        const valEl = document.createElement('span');
        valEl.className = 'val';
        valEl.textContent = String(v);
        item.append(keyEl, valEl);
        grid.appendChild(item);
      }
    }

    // Script viewer
    if (data.racerScripts && Object.keys(data.racerScripts).length > 0) {
      const viewer = document.createElement('script-viewer');
      viewer.slot = 'script-viewer';
      viewer.data = data.racerScripts;
      this.appendChild(viewer);
    }

    // Results
    const heading = root.querySelector('.results-heading');
    heading.textContent = `Results (${data.results.length})`;

    if (data.results.length === 0) {
      const empty = root.querySelector('.empty-state');
      empty.hidden = false;
      empty.querySelector('.icon').textContent = '\uD83D\uDCCA';
      empty.querySelector('p').textContent = 'No results yet. Run a race to see results here.';
    } else {
      for (const result of data.results) {
        const card = document.createElement('result-card');
        card.slot = 'results';
        card.data = { raceName: data.name, ...result };
        this.appendChild(card);
      }
    }
  }

  async #triggerRun(btn) {
    const controls = this.#controls;
    btn.disabled = true;
    btn.textContent = 'Starting...';

    const opts = controls.getOptions();

    try {
      const data = await api(`races/${encodeURIComponent(this.#raceName)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });

      controls.showStatus('running', 'Race is running...');

      // Start live view
      let liveView = this.querySelector('race-live-view');
      if (liveView) liveView.remove();
      liveView = document.createElement('race-live-view');
      liveView.slot = 'run-controls';
      this.#controls.after(liveView);

      const app = this.closest('race-app');

      const timer = setInterval(async () => {
        try {
          const status = await api(`races/status/${data.raceId}`);
          controls.setOutput(status.output || '');

          if (status.racerNames && status.racerNames.length > 0 && liveView && !liveView.dataset.started) {
            liveView.dataset.started = 'true';
            liveView.start(data.raceId, status.racerNames);
          }

          if (status.status !== 'running') {
            clearInterval(timer);
            this.#pollTimer = null;
            if (app) app.pollingTimer = null;
            if (liveView) liveView.stop();

            if (status.status === 'completed') {
              controls.showStatus('success', 'Race completed! Refreshing results...');
            } else {
              controls.showStatus('error', 'Race failed. Check output below.');
            }

            btn.disabled = false;
            btn.textContent = 'Run Race';

            setTimeout(() => {
              this.dispatchEvent(new CustomEvent('race-completed', {
                bubbles: true, composed: true,
              }));
            }, 1500);
          }
        } catch (e) { console.debug('Poll error (transient):', e.message); }
      }, 2000);

      this.#pollTimer = timer;
      if (app) app.pollingTimer = timer;
    } catch (err) {
      controls.showStatus('error', `Failed to start race: ${err.message}`);
      btn.disabled = false;
      btn.textContent = 'Run Race';
    }
  }
}

// --- <run-controls> ---

class RunControls extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [runControlsStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-run-controls'));
  }

  getOptions() {
    const root = this.shadowRoot;
    const opts = {};
    if (root.querySelector('[name="parallel"]').checked) opts.parallel = true;
    opts.headless = root.querySelector('[name="headless"]').checked;
    if (root.querySelector('[name="noRecording"]').checked) opts.noRecording = true;
    const runs = parseInt(root.querySelector('[name="runs"]').value, 10);
    if (runs > 1) opts.runs = runs;
    const network = root.querySelector('[name="network"]').value;
    if (network) opts.network = network;
    const cpu = parseInt(root.querySelector('[name="cpu"]').value, 10);
    if (cpu > 1) opts.cpu = cpu;
    return opts;
  }

  showStatus(type, message) {
    const root = this.shadowRoot;
    const status = root.querySelector('.status');
    const iconEl = root.querySelector('.status-icon');
    const msgEl = root.querySelector('.status-msg');
    const output = root.querySelector('.output');

    status.classList.add('visible');
    msgEl.textContent = message;

    iconEl.textContent = '';
    if (type === 'running') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      iconEl.appendChild(spinner);
      output.classList.add('visible');
    } else {
      iconEl.textContent = type === 'success' ? '\u2705' : '\u274C';
      if (type === 'success') {
        output.classList.remove('visible');
      }
    }
  }

  setOutput(text) {
    const output = this.shadowRoot.querySelector('.output');
    output.textContent = text;
    output.scrollTop = output.scrollHeight;
  }
}

// --- <script-viewer> ---

class ScriptViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [scriptViewerStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-script-viewer'));
  }

  set data(scripts) {
    const root = this.shadowRoot;
    const tabs = root.querySelector('.tabs');
    const content = root.querySelector('.content');
    tabs.textContent = '';
    content.textContent = '';
    const names = Object.keys(scripts);

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const panelId = `panel-${name}`;
      const tabId = `tab-${name}`;

      const tab = document.createElement('button');
      tab.id = tabId;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      tab.setAttribute('aria-controls', panelId);
      tab.textContent = name;
      tab.addEventListener('click', () => this.#switchTo(name));
      tabs.appendChild(tab);

      const pre = document.createElement('pre');
      pre.id = panelId;
      pre.setAttribute('role', 'tabpanel');
      pre.setAttribute('aria-labelledby', tabId);
      pre.dataset.name = name;
      pre.className = i === 0 ? 'active' : '';
      pre.textContent = scripts[name];
      content.appendChild(pre);
    }
  }

  #switchTo(name) {
    const root = this.shadowRoot;
    for (const tab of root.querySelectorAll('[role="tab"]')) {
      tab.setAttribute('aria-selected', tab.textContent === name ? 'true' : 'false');
    }
    for (const pre of root.querySelectorAll('pre')) {
      pre.classList.toggle('active', pre.dataset.name === name);
    }
  }
}

// --- <result-card> ---
// Fix #8: guard against duplicate listeners

class ResultCard extends HTMLElement {
  #open = false;
  #bound = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [resultCardStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-result-card'));
  }

  set data({ raceName, dir, summary }) {
    const root = this.shadowRoot;

    root.querySelector('.timestamp').textContent = formatResultDir(dir);

    const winnerEl = root.querySelector('.winner');
    winnerEl.textContent = '';
    if (summary && summary.overallWinner) {
      const trophy = document.createElement('span');
      trophy.textContent = '\uD83C\uDFC6';
      const name = document.createTextNode(` ${summary.overallWinner}`);
      winnerEl.append(trophy, name);
    } else {
      const noWin = document.createElement('span');
      noWin.className = 'no-winner';
      noWin.textContent = summary ? 'No winner' : 'No summary';
      winnerEl.appendChild(noWin);
    }

    if (!this.#bound) {
      this.#bound = true;
      const header = root.querySelector('.header');
      const body = root.querySelector('.body');
      header.addEventListener('click', () => {
        this.#open = !this.#open;
        body.classList.toggle('open', this.#open);
        header.setAttribute('aria-expanded', String(this.#open));
      });
    }

    if (!summary) return;

    const racers = summary.racers || [];

    if (summary.comparisons && summary.comparisons.length > 0) {
      const container = root.querySelector('.comparisons');
      container.textContent = '';
      for (const comp of summary.comparisons) {
        const chart = document.createElement('comparison-chart');
        chart.data = { comp, racers };
        container.appendChild(chart);
      }
    }

    if (summary.videos) {
      const entries = racers.filter(n => summary.videos[n]).map(n => ({
        name: n, path: summary.videos[n],
      }));
      if (entries.length > 0) {
        const videosEl = root.querySelector('.videos');
        videosEl.hidden = false;
        const grid = root.querySelector('.video-grid');
        grid.textContent = '';
        for (const v of entries) {
          const item = document.createElement('div');
          item.className = 'video-item';
          const video = document.createElement('video');
          video.controls = true;
          video.preload = 'metadata';
          video.src = `/api/races/${encodeURIComponent(raceName)}/results/${encodeURIComponent(dir)}/files/${v.path.split('/').map(encodeURIComponent).join('/')}`;
          const label = document.createElement('div');
          label.className = 'video-label';
          label.textContent = v.name;
          item.append(video, label);
          grid.appendChild(item);
        }
      }
    }

    if (summary.machineInfo) {
      const mi = summary.machineInfo;
      const infoEl = root.querySelector('.machine-info');
      infoEl.hidden = false;
      infoEl.textContent = '';
      const parts = [
        `${mi.platform || ''} ${mi.arch || ''}`,
        mi.cpuModel || '',
        `${mi.cpuCores || '?'} cores`,
        mi.totalMemoryMB ? `${Math.round(mi.totalMemoryMB / 1024)} GB RAM` : '',
        `Node ${mi.nodeVersion || '?'}`,
      ];
      for (const text of parts) {
        if (text.trim()) {
          const span = document.createElement('span');
          span.textContent = text;
          infoEl.appendChild(span);
        }
      }
    }

    const toggle = root.querySelector('.raw-toggle');
    const rawContent = root.querySelector('.raw-content');
    toggle.textContent = '\u25B8 Raw summary.json';
    rawContent.querySelector('pre').textContent = JSON.stringify(summary, null, 2);
    if (!toggle.dataset.bound) {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        const open = rawContent.classList.toggle('open');
        toggle.textContent = (open ? '\u25BE' : '\u25B8') + ' Raw summary.json';
        toggle.setAttribute('aria-expanded', String(open));
      });
    }
  }
}

// --- <comparison-chart> ---

class ComparisonChart extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [comparisonChartStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-comparison-chart'));
  }

  set data({ comp, racers }) {
    const root = this.shadowRoot;
    root.querySelector('.comp-name').textContent = comp.name;

    const maxDur = Math.max(...comp.racers.map(r => r?.duration || 0));
    const rows = root.querySelector('.rows');
    rows.textContent = '';

    for (let i = 0; i < racers.length; i++) {
      const r = comp.racers[i];
      const dur = r?.duration || 0;
      const pct = maxDur > 0 ? (dur / maxDur * 100) : 0;
      const color = RACER_COLORS[i % RACER_COLORS.length];
      const isWinner = comp.winner === racers[i];

      const row = document.createElement('div');
      row.className = 'bar-row';

      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = racers[i];
      label.style.color = color;

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${pct}%`;
      fill.style.background = color;
      track.appendChild(fill);

      const value = document.createElement('div');
      value.className = 'bar-value';
      value.textContent = dur ? `${dur.toFixed(3)}s` : 'N/A';

      const badge = document.createElement('div');
      badge.className = 'bar-badge';
      badge.textContent = isWinner ? '\uD83C\uDFC6' : '';

      row.append(label, track, value, badge);
      rows.appendChild(row);
    }
  }
}

// --- <race-live-view> ---
// Fix #14: skip poll if prior is still in flight

class RaceLiveView extends HTMLElement {
  #raceId = null;
  #racerNames = [];
  #pollTimer = null;
  #frameElements = new Map();
  #fetching = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [liveViewStyles];
    this.shadowRoot.appendChild(cloneTemplate('tmpl-race-live-view'));
  }

  disconnectedCallback() {
    this.stop();
  }

  start(raceId, racerNames) {
    this.#raceId = raceId;
    this.#racerNames = racerNames;
    this.#frameElements.clear();
    this.#fetching = false;

    const framesEl = this.shadowRoot.querySelector('.frames');
    framesEl.textContent = '';

    for (let i = 0; i < racerNames.length; i++) {
      const name = racerNames[i];
      const color = RACER_COLORS[i % RACER_COLORS.length];

      const item = document.createElement('div');
      item.className = 'frame-item';

      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'Waiting for frames...';
      item.appendChild(placeholder);

      const label = document.createElement('div');
      label.className = 'frame-label';
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = color;
      const nameEl = document.createTextNode(name);
      label.append(dot, nameEl);

      item.appendChild(label);
      framesEl.appendChild(item);
      this.#frameElements.set(name, { container: item, placeholder });
    }

    this.#pollTimer = setInterval(() => this.#fetchFrames(), 250);
  }

  stop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    const header = this.shadowRoot.querySelector('.live-header');
    header.classList.add('stopped');
    this.shadowRoot.querySelector('.live-label').textContent = 'Recording ended';
  }

  #fetchFrames() {
    if (this.#fetching) return;
    this.#fetching = true;
    let pending = this.#racerNames.length;

    const done = () => {
      if (--pending <= 0) this.#fetching = false;
    };

    for (const name of this.#racerNames) {
      const url = `/api/races/status/${this.#raceId}/frame/${encodeURIComponent(name)}?t=${Date.now()}`;
      const entry = this.#frameElements.get(name);
      if (!entry) { done(); continue; }

      const img = new Image();
      img.onload = () => {
        if (entry.placeholder) {
          entry.placeholder.remove();
          entry.placeholder = null;
        }
        const existing = entry.container.querySelector('img');
        if (existing) {
          existing.src = img.src;
        } else {
          img.style.cssText = 'width:100%;display:block;aspect-ratio:16/9;object-fit:contain;background:#000';
          entry.container.insertBefore(img, entry.container.firstChild);
        }
        done();
      };
      img.onerror = done;
      img.src = url;
    }
  }
}

// --- Register all components ---

customElements.define('race-app', RaceApp);
customElements.define('race-card', RaceCard);
customElements.define('race-detail', RaceDetail);
customElements.define('run-controls', RunControls);
customElements.define('script-viewer', ScriptViewer);
customElements.define('result-card', ResultCard);
customElements.define('comparison-chart', ComparisonChart);
customElements.define('race-live-view', RaceLiveView);

})();
