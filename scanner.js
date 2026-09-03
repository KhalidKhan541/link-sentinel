const LinkScanner = (() => {
  'use strict';

  const DEFAULT_OPTIONS = {
    concurrency: 10,
    timeout: 10000,
    delay: 100,
    followRedirects: true,
    maxRedirects: 5,
    retryFailed: true,
    validateContentType: false,
  };

  const STATUS_CLASSES = {
    ok: [200, 201, 202, 203, 204, 205, 206, 207, 208, 226],
    redirect: [300, 301, 302, 303, 304, 305, 307, 308],
    brokenClient: [400, 401, 403, 404, 405, 406, 407, 408, 409, 410,
      411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431],
    brokenServer: [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511],
  };

  function classifyStatus(code) {
    if (!code) return 'broken';
    if (STATUS_CLASSES.ok.includes(code)) return 'ok';
    if (STATUS_CLASSES.redirect.includes(code)) return 'redirect';
    return 'broken';
  }

  function getStatusText(code) {
    const texts = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found', 303: 'See Other',
      304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout',
      410: 'Gone', 429: 'Too Many Requests',
      500: 'Internal Server Error', 502: 'Bad Gateway',
      503: 'Service Unavailable', 504: 'Gateway Timeout',
    };
    return texts[code] || `Status ${code}`;
  }

  async function checkWithTimeout(url, options = {}) {
    const { timeout = 10000, method = 'HEAD', signal } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        method,
        mode: 'no-cors',
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async function checkUrl(url, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const result = {
      url,
      status: 'unknown',
      statusText: '',
      httpCode: null,
      error: null,
      type: 'link',
      redirects: 0,
      contentType: null,
      sslError: false,
      dnsError: false,
      corsBlocked: false,
      checkedAt: new Date().toISOString(),
    };

    try {
      const response = await checkWithTimeout(url, {
        timeout: opts.timeout,
        method: 'HEAD',
        signal: opts.abortSignal,
      });

      if (response.type === 'opaque') {
        result.status = 'ok';
        result.statusText = 'OK (opaque - CORS restricted)';
        result.corsBlocked = true;
        return result;
      }

      result.httpCode = response.status;
      result.statusText = response.statusText || getStatusText(response.status);
      result.status = classifyStatus(response.status);

      const contentType = response.headers.get('content-type');
      if (contentType) {
        result.contentType = contentType.split(';')[0].trim();
      }

      if (response.redirected) {
        result.redirects = response.url !== url ? 1 : 0;
      }

    } catch (err) {
      result.error = err.message || 'Unknown error';

      if (err.name === 'AbortError') {
        result.status = 'broken';
        result.statusText = 'Timeout';
      } else if (isDnsError(err)) {
        result.status = 'broken';
        result.statusText = 'DNS Error';
        result.dnsError = true;
      } else if (isSslError(err)) {
        result.status = 'broken';
        result.statusText = 'SSL Error';
        result.sslError = true;
      } else if (isCorsError(err)) {
        result.status = 'ok';
        result.statusText = 'OK (CORS)';
        result.corsBlocked = true;
      } else {
        result.status = 'broken';
        result.statusText = 'Error';
      }
    }

    return result;
  }

  function isDnsError(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('Failed to fetch') || msg.includes('NetworkError');
  }

  function isSslError(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('ssl') || msg.includes('certificate');
  }

  function isCorsError(err) {
    const msg = (err.message || '').toLowerCase();
    return msg.includes('cors') || msg.includes('network');
  }

  function generateReport(results) {
    const total = results.length;
    const broken = results.filter((r) => r.status === 'broken');
    const ok = results.filter((r) => r.status === 'ok');
    const redirect = results.filter((r) => r.status === 'redirect');

    const domainStats = {};
    broken.forEach((r) => {
      try {
        const domain = new URL(r.url).hostname;
        domainStats[domain] = (domainStats[domain] || 0) + 1;
      } catch {}
    });

    const topDomains = Object.entries(domainStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      summary: {
        total,
        ok: ok.length,
        broken: broken.length,
        redirect: redirect.length,
        brokenPercentage: total > 0 ? ((broken.length / total) * 100).toFixed(1) : 0,
      },
      brokenLinks: broken.map((r) => ({
        url: r.url,
        httpCode: r.httpCode,
        error: r.error,
        statusText: r.statusText,
        type: r.type,
      })),
      topBrokenDomains: topDomains.map(([domain, count]) => ({ domain, count })),
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    checkUrl,
    checkWithTimeout,
    classifyStatus,
    getStatusText,
    generateReport,
    DEFAULT_OPTIONS,
    STATUS_CLASSES,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LinkScanner;
}
