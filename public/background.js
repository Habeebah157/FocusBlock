const STORAGE_KEY = 'website-blocker-rules'
const ALARM_NAME = 'focusblock-expiry'

function getAllowedSites(state) {
  if (Array.isArray(state)) return state
  const folder = state?.folders?.find((candidate) => candidate.id === state.activeFolderId)
  return folder?.rules || []
}

function matchesBlocker(url, blocker) {
  try {
    const hostname = new URL(url).hostname
    return hostname === blocker.hostname || hostname.endsWith(`.${blocker.hostname}`)
  } catch {
    return false
  }
}

async function syncRules(state) {
  if (!Array.isArray(state) && !state?.enabled) {
    await chrome.alarms.clear(ALARM_NAME)
    return
  }
  const allowedSites = getAllowedSites(state)
  const activeAllowedSites = allowedSites.filter((site) => site.expiresAt > Date.now())
  if (Array.isArray(state)) await chrome.storage.local.set({ [STORAGE_KEY]: activeAllowedSites })
  await chrome.alarms.clear(ALARM_NAME)
  if (!Array.isArray(state) && allowedSites.length && !activeAllowedSites.length) {
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...state, enabled: false } })
    return
  }
  if (activeAllowedSites.length) {
    chrome.alarms.create(ALARM_NAME, { when: Math.min(...activeAllowedSites.map((site) => site.expiresAt)) })
  }
}

async function loadAndSync() {
  const result = await chrome.storage.local.get([STORAGE_KEY])
  await syncRules(result[STORAGE_KEY] || [])
}

function reportSyncError(error) {
  console.error('FocusBlock could not update blocking rules.', error)
}

function redirectIfBlocked(tabId, url, frameId = 0) {
  if (frameId !== 0 || !url || url.startsWith(chrome.runtime.getURL('/'))) return
  chrome.storage.local.get([STORAGE_KEY])
    .then((result) => {
      const state = result[STORAGE_KEY] || []
      if (!state?.enabled) return
      const activeAllowedSites = getAllowedSites(result[STORAGE_KEY] || [])
        .filter((site) => site.expiresAt > Date.now())
      const isAllowed = activeAllowedSites.some((site) => matchesBlocker(url, site))

      if (!isAllowed) {
        return chrome.tabs.update(tabId, {
          url: `${chrome.runtime.getURL('blocked.html')}?site=${encodeURIComponent(new URL(url).hostname)}`,
        })
      }
      return undefined
    })
    .catch(reportSyncError)
}

chrome.runtime.onInstalled.addListener(() => {
  loadAndSync().catch(reportSyncError)
})

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  redirectIfBlocked(tabId, url, frameId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) redirectIfBlocked(tabId, changeInfo.url)
})
chrome.runtime.onStartup.addListener(() => {
  loadAndSync().catch(reportSyncError)
})
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'SYNC_BLOCKERS') return false

  syncRules(message.state || message.blockers)
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
