const els = {
  credentialDot: document.querySelector('#credentialDot'),
  credentialText: document.querySelector('#credentialText'),
  tokenInput: document.querySelector('#tokenInput'),
  saveTokenBtn: document.querySelector('#saveTokenBtn'),
  clearTokenBtn: document.querySelector('#clearTokenBtn'),
  refreshBtn: document.querySelector('#refreshBtn'),
  rangeSelect: document.querySelector('#rangeSelect'),
  pollSelect: document.querySelector('#pollSelect'),
  pageSizeInput: document.querySelector('#pageSizeInput'),
  maxPagesInput: document.querySelector('#maxPagesInput'),
  csvLink: document.querySelector('#csvLink'),
  lastRefresh: document.querySelector('#lastRefresh'),
  windowSpend: document.querySelector('#windowSpend'),
  eventsFetched: document.querySelector('#eventsFetched'),
  totalTokens: document.querySelector('#totalTokens'),
  lastRequest: document.querySelector('#lastRequest'),
  cyclePlan: document.querySelector('#cyclePlan'),
  onDemand: document.querySelector('#onDemand'),
  modelTable: document.querySelector('#modelTable'),
  expensiveTable: document.querySelector('#expensiveTable'),
  diagnostics: document.querySelector('#diagnostics')
};

let pollTimer = null;
let lastSnapshot = null;
let allowTokenFromUi = false;

init();

async function init() {
  await refreshHealth();
  bindEvents();
  updateCsvLink();
  await refreshSnapshot();
  schedulePoll();
}

function bindEvents() {
  els.saveTokenBtn.addEventListener('click', saveToken);
  els.clearTokenBtn.addEventListener('click', clearToken);
  els.refreshBtn.addEventListener('click', refreshSnapshot);
  els.rangeSelect.addEventListener('change', () => { updateCsvLink(); refreshSnapshot(); });
  els.pageSizeInput.addEventListener('change', () => { updateCsvLink(); });
  els.maxPagesInput.addEventListener('change', () => { updateCsvLink(); });
  els.pollSelect.addEventListener('change', schedulePoll);
}

async function refreshHealth() {
  try {
    const health = await getJson('/api/health');
    allowTokenFromUi = Boolean(health.config?.allowTokenFromUi);
    configureTokenUi();
    renderCredential(health.credentials);
  } catch (err) {
    renderError(err);
  }
}

async function saveToken() {
  if (!allowTokenFromUi) return alert('Token paste is disabled. Put CURSOR_SESSION_TOKEN in .env or set ALLOW_TOKEN_FROM_UI=true.');
  const token = els.tokenInput.value.trim();
  if (!token) return alert('Paste the token first.');
  await withBusy(els.saveTokenBtn, async () => {
    const result = await postJson('/api/token', { token });
    els.tokenInput.value = '';
    renderCredential(result.credentials);
    await refreshSnapshot();
  });
}

async function clearToken() {
  await withBusy(els.clearTokenBtn, async () => {
    await fetch('/api/token', { method: 'DELETE' });
    await refreshHealth();
  });
}

async function refreshSnapshot() {
  await withBusy(els.refreshBtn, async () => {
    try {
      const params = new URLSearchParams({
        range: els.rangeSelect.value,
        pageSize: els.pageSizeInput.value || '100',
        maxPages: els.maxPagesInput.value || '3'
      });
      const snapshot = await getJson(`/api/snapshot?${params}`);
      lastSnapshot = snapshot;
      renderCredential(snapshot.credentials);
      renderSnapshot(snapshot);
      els.lastRefresh.textContent = `Last refreshed ${new Date().toLocaleTimeString()} for ${snapshot.query.label}.`;
    } catch (err) {
      renderError(err);
    }
  });
}

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  const seconds = Number(els.pollSelect.value || 0);
  if (seconds > 0) pollTimer = setInterval(refreshSnapshot, seconds * 1000);
}

function updateCsvLink() {
  const params = new URLSearchParams({
    range: els.rangeSelect.value,
    pageSize: els.pageSizeInput.value || '100',
    maxPages: els.maxPagesInput.value || '3'
  });
  els.csvLink.href = `/api/export.csv?${params}`;
}

function renderCredential(credentials = {}) {
  els.credentialDot.classList.toggle('ok', Boolean(credentials.hasCredentials));
  els.credentialDot.classList.toggle('bad', !credentials.hasCredentials);
  els.credentialText.textContent = credentials.hasCredentials
    ? `${credentials.authMode || 'dashboard'} credential configured`
    : 'Missing token';
}

function configureTokenUi() {
  els.tokenInput.disabled = !allowTokenFromUi;
  els.saveTokenBtn.disabled = !allowTokenFromUi;
  if (!allowTokenFromUi) {
    els.tokenInput.placeholder = 'Disabled. Set CURSOR_SESSION_TOKEN in .env, or ALLOW_TOKEN_FROM_UI=true to enable this form.';
  }
}

function renderSnapshot(snapshot) {
  const agg = snapshot.aggregate;
  const totals = agg.totals;
  const summary = snapshot.summary;

  els.windowSpend.textContent = money(totals.totalDollars);
  els.eventsFetched.textContent = number(totals.eventCount);
  els.totalTokens.textContent = compactNumber(totals.totalTokens);

  const last = agg.recentEvents?.[0];
  els.lastRequest.textContent = last ? `${money(last.chargedDollars || 0)} · ${last.model}` : '—';

  const plan = summary.plan || {};
  els.cyclePlan.textContent = plan.limit == null
    ? numberOrDash(plan.used)
    : `${number(plan.used)} / ${number(plan.limit)}`;

  const onDemand = summary.onDemand || {};
  els.onDemand.textContent = onDemand.usedCents == null ? '—' : money(onDemand.usedCents / 100);

  renderModelTable(agg.byModel || []);
  renderExpensiveTable(agg.mostExpensiveEvents || []);

  els.diagnostics.textContent = JSON.stringify({
    generatedAt: snapshot.generatedAt,
    query: snapshot.query,
    summary: snapshot.summary,
    eventsMeta: snapshot.eventsMeta,
    totals: snapshot.aggregate.totals,
    rawSummaryKeys: snapshot.rawSummaryKeys
  }, null, 2);
}

function renderModelTable(rows) {
  if (!rows.length) {
    els.modelTable.className = 'table-wrap empty';
    els.modelTable.textContent = 'No model rows for this window.';
    return;
  }
  els.modelTable.className = 'table-wrap';
  const maxCost = Math.max(...rows.map((r) => r.totalCents), 1);
  els.modelTable.innerHTML = `
    <table>
      <thead><tr><th>Model</th><th>Spend</th><th>Events</th><th>Tokens</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${escapeHtml(r.key)}</td>
            <td>${money(r.totalDollars)}</td>
            <td>${number(r.eventCount)}</td>
            <td>${compactNumber(r.totalTokens)}</td>
            <td><div class="bar"><span style="width:${Math.max(2, (r.totalCents / maxCost) * 100)}%"></span></div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderExpensiveTable(events) {
  if (!events.length) {
    els.expensiveTable.className = 'table-wrap empty';
    els.expensiveTable.textContent = 'No priced events found for this window.';
    return;
  }
  els.expensiveTable.className = 'table-wrap';
  els.expensiveTable.innerHTML = `
    <table>
      <thead><tr><th>Time</th><th>Model</th><th>Spend</th><th>Tokens</th><th>Flags</th></tr></thead>
      <tbody>
        ${events.slice(0, 25).map((e) => `
          <tr>
            <td>${e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
            <td>${escapeHtml(e.model)}</td>
            <td>${money(e.chargedDollars || 0)}</td>
            <td>${compactNumber(e.tokens.totalTokens)}</td>
            <td>${[e.isHeadless ? 'headless' : '', e.maxMode ? 'max' : '', e.isTokenBasedCall ? 'token' : ''].filter(Boolean).join(', ') || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderError(err) {
  els.lastRefresh.innerHTML = `<span class="error">${escapeHtml(err.message || String(err))}</span>`;
  els.diagnostics.textContent = JSON.stringify(err.details || { message: err.message }, null, 2);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const err = new Error(payload.message || `HTTP ${res.status}`);
    err.details = payload;
    throw err;
  }
  return payload;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const err = new Error(payload.message || `HTTP ${res.status}`);
    err.details = payload;
    throw err;
  }
  return payload;
}

async function withBusy(button, fn) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = 'Working…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}

function money(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.01 && n !== 0) return `${(n * 100).toFixed(2)}¢`;
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 4 : 2 });
}
function number(value) { return Number(value || 0).toLocaleString(); }
function numberOrDash(value) { return value == null ? '—' : number(value); }
function compactNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}
