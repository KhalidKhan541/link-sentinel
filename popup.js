const DOM = {
  scanCurrentBtn: document.getElementById('scanCurrentBtn'),
  scanAllBtn: document.getElementById('scanAllBtn'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('exportBtn'),
  historyBtn: document.getElementById('historyBtn'),
  backBtn: document.getElementById('backBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  themeToggle: document.getElementById('themeToggle'),
  speed: document.getElementById('speed'),
  progressSection: document.getElementById('progressSection'),
  progressText: document.getElementById('progressText'),
  progressCount: document.getElementById('progressCount'),
  progressFill: document.getElementById('progressFill'),
  resultsSection: document.getElementById('resultsSection'),
  resultsBody: document.getElementById('resultsBody'),
  totalLinks: document.getElementById('totalLinks'),
  brokenLinks: document.getElementById('brokenLinks'),
  okLinks: document.getElementById('okLinks'),
  redirectLinks: document.getElementById('redirectLinks'),
  historySection: document.getElementById('historySection'),
  historyList: document.getElementById('historyList'),
  emptyState: document.getElementById('emptyState'),
};

let currentFilter = 'all';
let currentResults = [];

const SPEED_CONFIG = {
  fast: { concurrency: 5, delay: 50, timeout: 8000 },
  moderate: { concurrency: 10, delay: 100, timeout: 10000 },
  slow: { concurrency: 20, delay: 200, timeout: 15000 },
};

function init() {
  loadTheme();
  loadSpeedPreference();
  setupEventListeners();
  listenForProgress();
}

function loadTheme() {
  const theme = localStorage.getItem('linkSentinelTheme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const icon = DOM.themeToggle.querySelector('svg');
  if (theme === 'dark') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  }
}

function loadSpeedPreference() {
  const speed = localStorage.getItem('linkSentinelSpeed') || 'moderate';
  DOM.speed.value = speed;
}

function setupEventListeners() {
  DOM.themeToggle.addEventListener('click', toggleTheme);
  DOM.scanCurrentBtn.addEventListener('click', () => scanCurrentPage());
  DOM.scanAllBtn.addEventListener('click', () => scanAllTabs());
  DOM.stopBtn.addEventListener('click', stopScan);
  DOM.exportBtn.addEventListener('click', exportCSV);
  DOM.historyBtn.addEventListener('click', showHistory);
  DOM.backBtn.addEventListener('click', hideHistory);
  DOM.clearHistoryBtn.addEventListener('click', clearHistory);
  DOM.speed.addEventListener('change', (e) => {
    localStorage.setItem('linkSentinelSpeed', e.target.value);
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderResults();
    });
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('linkSentinelTheme', next);
  updateThemeIcon(next);
}

async function scanCurrentPage() {
  showProgress();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
      chrome.runtime.sendMessage({
        action: 'scanTab',
        tabId: tab.id,
        url: tab.url,
        config: SPEED_CONFIG[DOM.speed.value],
      });
    } else {
      hideProgress();
      alert('Cannot scan this page (chrome:// or about: pages)');
    }
  } catch (err) {
    hideProgress();
    console.error('Scan error:', err);
  }
}

async function scanAllTabs() {
  showProgress();
  try {
    const tabs = await chrome.tabs.query({});
    const httpTabs = tabs.filter(
      (t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))
    );
    chrome.runtime.sendMessage({
      action: 'scanAllTabs',
      tabs: httpTabs.map((t) => ({ id: t.id, url: t.url })),
      config: SPEED_CONFIG[DOM.speed.value],
    });
  } catch (err) {
    hideProgress();
    console.error('Scan all error:', err);
  }
}

function stopScan() {
  chrome.runtime.sendMessage({ action: 'stopScan' });
  hideProgress();
}

function showProgress() {
  DOM.emptyState.classList.add('hidden');
  DOM.resultsSection.classList.add('hidden');
  DOM.historySection.classList.add('hidden');
  DOM.progressSection.classList.remove('hidden');
  DOM.progressFill.style.width = '0%';
  DOM.progressText.textContent = 'Scanning...';
  DOM.progressCount.textContent = '0/0';
  DOM.scanCurrentBtn.classList.add('scanning');
  DOM.scanAllBtn.classList.add('scanning');
}

function hideProgress() {
  DOM.progressSection.classList.add('hidden');
  DOM.scanCurrentBtn.classList.remove('scanning');
  DOM.scanAllBtn.classList.remove('scanning');
}

function listenForProgress() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'scanProgress') {
      updateProgress(msg.completed, msg.total, msg.text);
    } else if (msg.action === 'scanComplete') {
      handleScanComplete(msg.results);
    } else if (msg.action === 'scanError') {
      hideProgress();
      console.error('Scan error:', msg.error);
    }
  });
}

function updateProgress(completed, total, text) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  DOM.progressFill.style.width = pct + '%';
  DOM.progressCount.textContent = `${completed}/${total}`;
  if (text) DOM.progressText.textContent = text;
}

function handleScanComplete(results) {
  hideProgress();
  currentResults = results;
  DOM.emptyState.classList.add('hidden');
  DOM.historySection.classList.add('hidden');
  DOM.resultsSection.classList.remove('hidden');
  updateStats();
  renderResults();
  saveToHistory(results);
}

function updateStats() {
  const total = currentResults.length;
  const broken = currentResults.filter((r) => r.status === 'broken').length;
  const ok = currentResults.filter((r) => r.status === 'ok').length;
  const redirect = currentResults.filter((r) => r.status === 'redirect').length;
  DOM.totalLinks.textContent = `${total} links`;
  DOM.brokenLinks.textContent = `${broken} broken`;
  DOM.okLinks.textContent = `${ok} OK`;
  DOM.redirectLinks.textContent = `${redirect} redirects`;

  chrome.runtime.sendMessage({ action: 'updateBadge', count: broken });
}

function renderResults() {
  let filtered = currentResults;
  if (currentFilter !== 'all') {
    filtered = currentResults.filter((r) => r.status === currentFilter);
  }

  DOM.resultsBody.innerHTML = '';
  filtered.forEach((result) => {
    const row = document.createElement('tr');
    row.className = `status-${result.status}`;
    row.innerHTML = `
      <td title="${result.url}">${truncateUrl(result.url)}</td>
      <td><span class="status-badge ${result.status}">${result.statusText}</span></td>
      <td>${result.type}</td>
      <td>${result.httpCode || 'N/A'}</td>
    `;
    row.addEventListener('click', () => highlightLink(result.url));
    DOM.resultsBody.appendChild(row);
  });
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    let display = u.hostname + u.pathname;
    if (display.length > 40) {
      display = display.substring(0, 37) + '...';
    }
    return display;
  } catch {
    return url.substring(0, 40);
  }
}

async function highlightLink(url) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'highlightLink', url });
  } catch (err) {
    console.error('Highlight error:', err);
  }
}

function exportCSV() {
  if (currentResults.length === 0) return;

  const headers = ['URL', 'Status', 'Type', 'HTTP Code', 'Error'];
  const rows = currentResults.map((r) => [
    r.url,
    r.statusText,
    r.type,
    r.httpCode || '',
    r.error || '',
  ]);

  const csvContent = [headers, ...rows].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `link-sentinel-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function saveToHistory(results) {
  const broken = results.filter((r) => r.status === 'broken').length;
  const total = results.length;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const entry = {
    id: Date.now(),
    url: tab?.url || 'Unknown',
    title: tab?.title || 'Unknown',
    date: new Date().toISOString(),
    total,
    broken,
    results,
  };

  const data = await StorageManager.getScanHistory();
  data.unshift(entry);
  if (data.length > 20) data.pop();
  await StorageManager.setScanHistory(data);
}

function showHistory() {
  DOM.emptyState.classList.add('hidden');
  DOM.resultsSection.classList.add('hidden');
  DOM.progressSection.classList.add('hidden');
  DOM.historySection.classList.remove('hidden');
  loadHistory();
}

function hideHistory() {
  DOM.historySection.classList.add('hidden');
  if (currentResults.length > 0) {
    DOM.resultsSection.classList.remove('hidden');
  } else {
    DOM.emptyState.classList.remove('hidden');
  }
}

async function loadHistory() {
  const history = await StorageManager.getScanHistory();
  DOM.historyList.innerHTML = '';

  if (history.length === 0) {
    DOM.historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">No scan history yet</p>';
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-url">${truncateUrl(entry.url)}</div>
        <div class="history-item-date">${new Date(entry.date).toLocaleString()}</div>
      </div>
      <div class="history-item-stats">
        <span class="history-item-stat stat">${entry.total} links</span>
        <span class="history-item-stat stat-broken">${entry.broken} broken</span>
      </div>
    `;
    item.addEventListener('click', () => {
      currentResults = entry.results;
      hideHistory();
      DOM.resultsSection.classList.remove('hidden');
      updateStats();
      renderResults();
    });
    DOM.historyList.appendChild(item);
  });
}

async function clearHistory() {
  await StorageManager.setScanHistory([]);
  loadHistory();
}

document.addEventListener('DOMContentLoaded', init);
