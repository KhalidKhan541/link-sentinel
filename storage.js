const StorageManager = (() => {
  'use strict';

  const KEYS = {
    SCAN_HISTORY: 'linkSentinelScanHistory',
    DOMAIN_STATS: 'linkSentinelDomainStats',
    SETTINGS: 'linkSentinelSettings',
  };

  const MAX_HISTORY = 20;

  async function get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] || null);
      });
    });
  }

  async function set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  async function getScanHistory() {
    const history = await get(KEYS.SCAN_HISTORY);
    return history || [];
  }

  async function setScanHistory(history) {
    await set(KEYS.SCAN_HISTORY, history);
  }

  async function addScanEntry(entry) {
    const history = await getScanHistory();
    history.unshift(entry);
    if (history.length > MAX_HISTORY) {
      history.pop();
    }
    await setScanHistory(history);
    await updateDomainStats(entry.results);
    return history;
  }

  async function clearScanHistory() {
    await setScanHistory([]);
    await set(KEYS.DOMAIN_STATS, {});
  }

  async function getDomainStats() {
    const stats = await get(KEYS.DOMAIN_STATS);
    return stats || {};
  }

  async function updateDomainStats(results) {
    const stats = await getDomainStats();

    results.forEach((result) => {
      if (result.status === 'broken') {
        try {
          const domain = new URL(result.url).hostname;
          if (!stats[domain]) {
            stats[domain] = {
              count: 0,
              lastSeen: null,
              urls: [],
            };
          }
          stats[domain].count++;
          stats[domain].lastSeen = new Date().toISOString();
          if (stats[domain].urls.length < 5) {
            stats[domain].urls.push(result.url);
          }
        } catch {}
      }
    });

    await set(KEYS.DOMAIN_STATS, stats);
    return stats;
  }

  async function getTopBrokenDomains(limit = 10) {
    const stats = await getDomainStats();
    return Object.entries(stats)
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        lastSeen: data.lastSeen,
        urls: data.urls,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  async function getStatistics() {
    const history = await getScanHistory();
    const domainStats = await getDomainStats();

    if (history.length === 0) {
      return {
        totalScans: 0,
        totalLinksChecked: 0,
        totalBrokenFound: 0,
        averageBrokenPerScan: 0,
        mostCommonBrokenDomains: [],
        recentActivity: [],
      };
    }

    let totalLinks = 0;
    let totalBroken = 0;
    history.forEach((entry) => {
      totalLinks += entry.total || 0;
      totalBroken += entry.broken || 0;
    });

    const topDomains = Object.entries(domainStats)
      .map(([domain, data]) => ({ domain, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const recentActivity = history.slice(0, 5).map((entry) => ({
      url: entry.url,
      date: entry.date,
      broken: entry.broken,
      total: entry.total,
    }));

    return {
      totalScans: history.length,
      totalLinksChecked: totalLinks,
      totalBrokenFound: totalBroken,
      averageBrokenPerScan: history.length > 0
        ? (totalBroken / history.length).toFixed(1)
        : 0,
      mostCommonBrokenDomains: topDomains,
      recentActivity,
    };
  }

  async function getSettings() {
    const settings = await get(KEYS.SETTINGS);
    return settings || {
      speed: 'moderate',
      theme: 'light',
      showOverlay: true,
      autoScan: false,
    };
  }

  async function saveSettings(settings) {
    await set(KEYS.SETTINGS, settings);
  }

  async function exportData() {
    const history = await getScanHistory();
    const domainStats = await getDomainStats();
    const settings = await getSettings();
    const statistics = await getStatistics();

    return {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      history,
      domainStats,
      settings,
      statistics,
    };
  }

  async function importData(data) {
    if (!data || !data.version) {
      throw new Error('Invalid data format');
    }

    if (data.history) {
      await setScanHistory(data.history);
    }
    if (data.domainStats) {
      await set(KEYS.DOMAIN_STATS, data.domainStats);
    }
    if (data.settings) {
      await saveSettings(data.settings);
    }

    return true;
  }

  async function getStorageSize() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve(bytes);
      });
    });
  }

  return {
    getScanHistory,
    setScanHistory,
    addScanEntry,
    clearScanHistory,
    getDomainStats,
    getTopBrokenDomains,
    getStatistics,
    getSettings,
    saveSettings,
    exportData,
    importData,
    getStorageSize,
    KEYS,
    MAX_HISTORY,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
