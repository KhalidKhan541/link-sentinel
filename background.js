let isScanning = false;
let abortController = null;

const DEFAULT_CONFIG = {
  concurrency: 10,
  delay: 100,
  timeout: 10000,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanTab') {
    handleScanTab(msg.tabId, msg.url, msg.config);
    sendResponse({ started: true });
  } else if (msg.action === 'scanAllTabs') {
    handleScanAllTabs(msg.tabs, msg.config);
    sendResponse({ started: true });
  } else if (msg.action === 'stopScan') {
    handleStopScan();
    sendResponse({ stopped: true });
  } else if (msg.action === 'updateBadge') {
    updateBadge(msg.count);
    sendResponse({ success: true });
  }
  return true;
});

async function handleScanTab(tabId, url, config) {
  if (isScanning) {
    stopCurrentScan();
    await sleep(200);
  }

  isScanning = true;
  abortController = new AbortController();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    let urls = [];
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'extractUrls' });
      urls = response.urls || [];
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      const response = await chrome.tabs.sendMessage(tabId, { action: 'extractUrls' });
      urls = response.urls || [];
    }

    if (urls.length === 0) {
      broadcastToPopup({ action: 'scanComplete', results: [] });
      isScanning = false;
      return;
    }

    const results = await scanUrls(urls, cfg);
    broadcastToPopup({ action: 'scanComplete', results });

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'showOverlay', results });
    } catch (e) {
      // Content script might not be available
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      broadcastToPopup({ action: 'scanError', error: err.message });
    }
  } finally {
    isScanning = false;
    abortController = null;
  }
}

async function handleScanAllTabs(tabs, config) {
  if (isScanning) {
    stopCurrentScan();
    await sleep(200);
  }

  isScanning = true;
  abortController = new AbortController();
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const allResults = [];
  let completed = 0;
  const total = tabs.length;

  for (const tab of tabs) {
    if (!isScanning) break;

    broadcastToPopup({
      action: 'scanProgress',
      completed,
      total,
      text: `Scanning: ${new URL(tab.url).hostname}`,
    });

    try {
      let urls = [];
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractUrls' });
        urls = response.urls || [];
      } catch (e) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractUrls' });
        urls = response.urls || [];
      }

      const results = await scanUrls(urls, cfg);
      results.forEach((r) => {
        r.sourceTab = tab.url;
      });
      allResults.push(...results);

      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'showOverlay', results });
      } catch (e) {
        // Content script might not be available
      }
    } catch (err) {
      console.error(`Error scanning tab ${tab.url}:`, err);
    }

    completed++;
  }

  broadcastToPopup({ action: 'scanComplete', results: allResults });
  isScanning = false;
  abortController = null;
}

function handleStopScan() {
  if (abortController) {
    abortController.abort();
  }
  isScanning = false;
}

function stopCurrentScan() {
  if (abortController) {
    abortController.abort();
  }
  isScanning = false;
}

async function scanUrls(urls, config) {
  const results = [];
  const queue = [...urls];
  const active = new Set();
  let completed = 0;

  return new Promise((resolve) => {
    function broadcastProgress() {
      broadcastToPopup({
        action: 'scanProgress',
        completed,
        total: urls.length,
        text: `Checking links... (${completed}/${urls.length})`,
      });
    }

    async function processNext() {
      if (!isScanning || queue.length === 0) {
        if (active.size === 0) {
          resolve(results);
        }
        return;
      }

      const { url, type } = queue.shift();
      const promise = checkUrl(url, config)
        .then((result) => {
          result.type = type;
          results.push(result);
        })
        .catch((err) => {
          results.push({
            url,
            type,
            status: 'broken',
            statusText: 'Error',
            httpCode: null,
            error: err.message,
          });
        })
        .finally(() => {
          active.delete(promise);
          completed++;
          broadcastProgress();
          processNext();
        });

      active.add(promise);

      if (config.delay > 0) {
        await sleep(config.delay);
      }
    }

    const initialBatch = Math.min(config.concurrency, queue.length);
    for (let i = 0; i < initialBatch; i++) {
      processNext();
    }
  });
}

async function checkUrl(url, config, isRetry = false) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    const status = response.status;
    const statusText = response.statusText || getStatusText(status);

    if (response.type === 'opaque') {
      return {
        url,
        status: 'ok',
        statusText: 'OK (opaque)',
        httpCode: null,
        error: null,
      };
    }

    if (status >= 200 && status < 300) {
      return {
        url,
        status: 'ok',
        statusText,
        httpCode: status,
        error: null,
      };
    } else if (status >= 300 && status < 400) {
      return {
        url,
        status: 'redirect',
        statusText,
        httpCode: status,
        error: null,
      };
    } else {
      if (!isRetry && shouldRetry(status)) {
        await sleep(500);
        return checkUrl(url, config, true);
      }
      return {
        url,
        status: 'broken',
        statusText,
        httpCode: status,
        error: statusText,
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      if (!isRetry) {
        await sleep(500);
        return checkUrl(url, config, true);
      }
      return {
        url,
        status: 'broken',
        statusText: 'Timeout',
        httpCode: null,
        error: 'Request timed out',
      };
    }

    if (isCorsError(err)) {
      return {
        url,
        status: 'ok',
        statusText: 'OK (CORS)',
        httpCode: null,
        error: null,
      };
    }

    if (isDnsError(err)) {
      return {
        url,
        status: 'broken',
        statusText: 'DNS Error',
        httpCode: null,
        error: 'DNS resolution failed',
      };
    }

    if (isSslError(err)) {
      return {
        url,
        status: 'broken',
        statusText: 'SSL Error',
        httpCode: null,
        error: 'SSL certificate error',
      };
    }

    if (!isRetry) {
      await sleep(500);
      return checkUrl(url, config, true);
    }

    return {
      url,
      status: 'broken',
      statusText: 'Error',
      httpCode: null,
      error: err.message || 'Network error',
    };
  }
}

function shouldRetry(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function isCorsError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('cors') || msg.includes('cross-origin') || msg.includes('network');
}

function isDnsError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('dns') || msg.includes('resolve') || msg.includes('host');
}

function isSslError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('ssl') || msg.includes('certificate') || msg.includes('tls');
}

function getStatusText(code) {
  const texts = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    410: 'Gone',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return texts[code] || `Status ${code}`;
}

function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.action.setBadgeText({ text: count.toString() });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup is not open
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});
