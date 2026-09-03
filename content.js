(() => {
  'use strict';

  const SELECTORS = {
    a: 'a[href]',
    img: 'img[src]',
    script: 'script[src]',
    link: 'link[href]',
    iframe: 'iframe[src]',
    video: 'video[src]',
    audio: 'audio[src]',
    videoSource: 'video source[src]',
    audioSource: 'audio source[src]',
    poster: 'img[poster]',
    dataSrc: '[data-src]',
    dataBg: '[style*="background-image"]',
  };

  const TYPE_MAP = {
    a: 'link',
    img: 'image',
    script: 'script',
    link: 'stylesheet',
    iframe: 'iframe',
    video: 'video',
    audio: 'audio',
    videoSource: 'video',
    audioSource: 'audio',
    dataSrc: 'lazy-load',
    dataBg: 'background-image',
  };

  let overlayContainer = null;

  function extractUrls() {
    const urls = new Map();

    Object.entries(SELECTORS).forEach(([key, selector]) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          let url = null;

          if (key === 'dataSrc') {
            url = el.getAttribute('data-src');
          } else if (key === 'dataBg') {
            const style = el.getAttribute('style') || '';
            const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
            if (match) url = match[1];
          } else {
            url = el.getAttribute('src') || el.getAttribute('href');
          }

          if (url && url.trim() && !url.startsWith('data:') && !url.startsWith('javascript:')) {
            try {
              const absoluteUrl = new URL(url, window.location.href).href;
              const type = TYPE_MAP[key] || 'link';
              if (!urls.has(absoluteUrl)) {
                urls.set(absoluteUrl, { type, element: el });
              }
            } catch (e) {
              // Invalid URL, skip
            }
          }
        });
      } catch (e) {
        // Selector not supported, skip
      }
    });

    return urls;
  }

  function showOverlay(results) {
    removeOverlay();

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'link-sentinel-overlay';
    overlayContainer.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 16px;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      max-height: 80vh;
      overflow-y: auto;
      width: 320px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      animation: slideIn 0.3s ease;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      .ls-overlay-item {
        padding: 8px 12px;
        margin: 4px 0;
        border-radius: 6px;
        font-size: 12px;
        word-break: break-all;
        cursor: pointer;
        transition: background 0.2s;
      }
      .ls-overlay-item:hover { background: rgba(255,255,255,0.1); }
      .ls-overlay-broken { border-left: 3px solid #ef4444; background: rgba(239,68,68,0.15); }
      .ls-overlay-ok { border-left: 3px solid #10b981; }
      .ls-overlay-redirect { border-left: 3px solid #f59e0b; }
      .ls-overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
      }
      .ls-overlay-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        font-size: 18px;
        padding: 0 4px;
      }
      .ls-overlay-close:hover { opacity: 0.7; }
      .ls-highlight-broken {
        outline: 3px solid #ef4444 !important;
        outline-offset: 2px;
        animation: ls-pulse 1s infinite;
      }
      @keyframes ls-pulse {
        0%, 100% { outline-color: #ef4444; }
        50% { outline-color: #f87171; }
      }
    `;
    overlayContainer.appendChild(style);

    const broken = results.filter((r) => r.status === 'broken');
    const ok = results.filter((r) => r.status === 'ok');
    const redirect = results.filter((r) => r.status === 'redirect');

    const header = document.createElement('div');
    header.className = 'ls-overlay-header';
    header.innerHTML = `
      <span><strong>Link Sentinel</strong> - ${results.length} links scanned</span>
      <button class="ls-overlay-close">&times;</button>
    `;
    header.querySelector('.ls-overlay-close').addEventListener('click', removeOverlay);
    overlayContainer.appendChild(header);

    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;font-size:12px;';
    summary.innerHTML = `
      <span style="color:#10b981">${ok.length} OK</span>
      <span style="color:#f59e0b">${redirect.length} redirects</span>
      <span style="color:#ef4444">${broken.length} broken</span>
    `;
    overlayContainer.appendChild(summary);

    const list = document.createElement('div');

    broken.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'ls-overlay-item ls-overlay-broken';
      item.textContent = r.url;
      item.title = `HTTP ${r.httpCode || 'N/A'} - ${r.error || 'Broken'}`;
      item.addEventListener('click', () => {
        highlightElement(r.url);
      });
      list.appendChild(item);
    });

    if (broken.length === 0) {
      const noBroken = document.createElement('div');
      noBroken.style.cssText = 'text-align:center;padding:20px;color:#10b981;';
      noBroken.textContent = 'No broken links found!';
      list.appendChild(noBroken);
    }

    overlayContainer.appendChild(list);
    document.body.appendChild(overlayContainer);

    highlightBrokenElements(broken);
  }

  function removeOverlay() {
    if (overlayContainer) {
      overlayContainer.remove();
      overlayContainer = null;
    }
    document.querySelectorAll('.ls-highlight-broken').forEach((el) => {
      el.classList.remove('ls-highlight-broken');
    });
  }

  function highlightBrokenElements(brokenResults) {
    const urlMap = extractUrls();
    brokenResults.forEach((result) => {
      const entry = urlMap.get(result.url);
      if (entry && entry.element) {
        entry.element.classList.add('ls-highlight-broken');
      }
    });
  }

  function highlightElement(url) {
    const urlMap = extractUrls();
    const entry = urlMap.get(url);
    if (entry && entry.element) {
      document.querySelectorAll('.ls-highlight-broken').forEach((el) => {
        el.classList.remove('ls-highlight-broken');
      });
      entry.element.classList.add('ls-highlight-broken');
      entry.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'extractUrls') {
      const urlMap = extractUrls();
      const urls = Array.from(urlMap.entries()).map(([url, info]) => ({
        url,
        type: info.type,
      }));
      sendResponse({ urls });
    } else if (msg.action === 'showOverlay') {
      showOverlay(msg.results);
      sendResponse({ success: true });
    } else if (msg.action === 'highlightLink') {
      highlightElement(msg.url);
      sendResponse({ success: true });
    } else if (msg.action === 'removeOverlay') {
      removeOverlay();
      sendResponse({ success: true });
    }
    return true;
  });
})();
