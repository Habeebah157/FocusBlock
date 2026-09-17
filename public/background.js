const STORAGE_KEY = 'website-blocker-rules'
const ALARM_NAME = 'focusblock-expiry'

function matchesBlocker(url, blocker) {
  try {
    const hostname = new URL(url).hostname
    return hostname === blocker.hostname || hostname.endsWith(`.${blocker.hostname}`)
  } catch {
    return false
  }
}

async function syncRules(blockers) {
  const activeBlockers = blockers.filter((blocker) => blocker.expiresAt > Date.now())
  const rules = activeBlockers.map((blocker, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${blocker.hostname}^`,
      resourceTypes: ['main_frame'],
    },
  }))

  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules,
  })
  await chrome.storage.local.set({ [STORAGE_KEY]: activeBlockers })
  await chrome.alarms.clear(ALARM_NAME)
  if (activeBlockers.length) {
    chrome.alarms.create(ALARM_NAME, { when: Math.min(...activeBlockers.map((blocker) => blocker.expiresAt)) })
  }
}

async function loadAndSync() {
  const result = await chrome.storage.local.get([STORAGE_KEY])
  await syncRules(result[STORAGE_KEY] || [])
}

function reportSyncError(error) {
  console.error('FocusBlock could not update blocking rules.', error)
}

chrome.runtime.onInstalled.addListener(() => {
  loadAndSync().catch(reportSyncError)

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return

    chrome.storage.local.get([STORAGE_KEY])
      .then((result) => {
        const activeBlockers = (result[STORAGE_KEY] || [])
          .filter((blocker) => blocker.expiresAt > Date.now())
        const blocker = activeBlockers.find((candidate) => matchesBlocker(changeInfo.url, candidate))

        if (blocker) {
          return chrome.tabs.update(tabId, { url: chrome.runtime.getURL('blocked.html') })
        }
        return undefined
      })
      .catch(reportSyncError)
  })
})
chrome.runtime.onStartup.addListener(() => {
  loadAndSync().catch(reportSyncError)
})
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'SYNC_BLOCKERS') return false

  syncRules(message.blockers)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      reportSyncError(error)
      sendResponse({ ok: false, message: error.message })
    })
  return true
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) loadAndSync().catch(reportSyncError)
})

loadAndSync().catch(reportSyncError)
