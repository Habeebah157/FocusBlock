import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'website-blocker-rules'
const DEFAULT_FOLDER = { id: 'deep-work', name: 'Deep work', rules: [] }
const durations = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
  { value: 1440, label: '24 hours' },
]

function extensionApi() {
  const api = globalThis.chrome
  return api?.storage?.local && api?.runtime ? api : null
}

function normalizeUrl(value) {
  const candidate = value.trim()
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`
  const url = new URL(withProtocol)

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Enter a valid website address.')
  }

  return {
    displayUrl: `${url.protocol}//${url.hostname.replace(/^www\./i, '')}`,
    hostname: url.hostname,
  }
}

function formatRemaining(expiresAt) {
  const remaining = Math.max(0, expiresAt - Date.now())
  const minutes = Math.ceil(remaining / 60000)
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`
}

function normalizeState(value) {
  if (Array.isArray(value)) {
    return { enabled: false, folders: [{ ...DEFAULT_FOLDER, rules: value }], activeFolderId: DEFAULT_FOLDER.id }
  }

  if (value?.folders?.length) return { ...value, enabled: value.enabled === true }
  return { enabled: false, folders: [DEFAULT_FOLDER], activeFolderId: DEFAULT_FOLDER.id }
}

function readState() {
  const api = extensionApi()
  if (api) {
    return new Promise((resolve) => {
      api.storage.local.get([STORAGE_KEY], (result) => resolve(normalizeState(result[STORAGE_KEY])))
    })
  }

  try {
    return Promise.resolve(normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')))
  } catch {
    return Promise.resolve(normalizeState())
  }
}

async function saveState(state) {
  const api = extensionApi()
  if (api) {
    await new Promise((resolve, reject) => {
      api.storage.local.set({ [STORAGE_KEY]: state }, () => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message))
          return
        }
        resolve()
      })
    })
    await new Promise((resolve, reject) => {
      api.runtime.sendMessage({ type: 'SYNC_BLOCKERS', state }, (response) => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message))
          return
        }
        if (!response?.ok) {
          reject(new Error(response?.message || 'The browser could not update blocking rules.'))
          return
        }
        resolve()
      })
    })
    return
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function App() {
  const [enabled, setEnabled] = useState(false)
  const [folders, setFolders] = useState([])
  const [activeFolderId, setActiveFolderId] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    readState().then((storedState) => {
      const nextFolders = storedState.folders.map((folder) => ({
        ...folder,
        rules: folder.rules.filter((rule) => rule.expiresAt > Date.now()),
      }))
      const nextActiveFolderId = nextFolders.some((folder) => folder.id === storedState.activeFolderId)
        ? storedState.activeFolderId
        : nextFolders[0].id
      setFolders(nextFolders)
      setActiveFolderId(nextActiveFolderId)
      setEnabled(storedState.enabled)
      if (nextFolders.some((folder, index) => folder.rules.length !== storedState.folders[index].rules.length)) {
        saveState({ enabled: storedState.enabled, folders: nextFolders, activeFolderId: nextActiveFolderId }).catch((saveError) => setError(saveError.message))
      }
    })
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || folders[0]
  const activeRules = useMemo(() => activeFolder?.rules.filter((rule) => rule.expiresAt > now) || [], [activeFolder, now])
  const blockingEnabled = enabled && !(activeFolder?.rules.length && !activeRules.length)

  useEffect(() => {
    if (!enabled || activeRules.length || !activeFolder?.rules.length) return

    saveState({ enabled: false, folders, activeFolderId }).catch((saveError) => setError(saveError.message))
  }, [activeFolder, activeFolderId, activeRules, enabled, folders])

  function persistFolders(nextFolders, nextActiveFolderId = activeFolderId) {
    setFolders(nextFolders)
    setActiveFolderId(nextActiveFolderId)
    saveState({ enabled: blockingEnabled, folders: nextFolders, activeFolderId: nextActiveFolderId }).catch((saveError) => setError(saveError.message))
  }

  function toggleBlocking() {
    const nextEnabled = !blockingEnabled
    setEnabled(nextEnabled)
    saveState({ enabled: nextEnabled, folders, activeFolderId }).catch((saveError) => setError(saveError.message))
  }

  function addFolder(event) {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name) return
    if (folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
      setError('That mood already exists.')
      return
    }
    const folder = { id: crypto.randomUUID(), name, rules: [] }
    persistFolders([...folders, folder], folder.id)
    setNewFolderName('')
    setError('')
  }

  function selectFolder(folderId) {
    persistFolders(folders, folderId)
  }

  function removeFolder(folderId) {
    if (folders.length === 1) {
      setError('Keep at least one mood in FocusBlock.')
      return
    }

    const folderIndex = folders.findIndex((folder) => folder.id === folderId)
    const nextFolders = folders.filter((folder) => folder.id !== folderId)
    const nextActiveFolderId = folderId === activeFolderId
      ? nextFolders[Math.max(0, folderIndex - 1)]?.id || nextFolders[0].id
      : activeFolderId
    persistFolders(nextFolders, nextActiveFolderId)
    setError('')
  }

  function addRule(event) {
    event.preventDefault()
    setError('')

    try {
      const { displayUrl, hostname } = normalizeUrl(url)
      if (activeRules.some((rule) => rule.hostname === hostname)) {
        setError('That website is already allowed in this mood.')
        return
      }

      const rule = {
        id: crypto.randomUUID(),
        hostname,
        displayUrl,
        expiresAt: Date.now() + duration * 60000,
      }
      const nextFolders = folders.map((folder) => folder.id === activeFolderId
        ? { ...folder, rules: [...activeRules, rule] }
        : folder)
      persistFolders(nextFolders)
      setUrl('')
    } catch {
      setError('Enter a valid website address, like youtube.com.')
    }
  }

  function removeRule(id) {
    const nextFolders = folders.map((folder) => folder.id === activeFolderId
      ? { ...folder, rules: activeRules.filter((rule) => rule.id !== id) }
      : folder)
    persistFolders(nextFolders)
  }

  function openWebVersion() {
    const api = extensionApi()
    if (api) {
      api.tabs.create({ url: api.runtime.getURL('index.html?mode=web') })
    } else {
      window.open(`${window.location.origin}${window.location.pathname}?mode=web`, '_blank')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span>FocusBlock</span>
        </div>
        <button className="web-button" type="button" onClick={openWebVersion}>
          <span>↗</span> Web version
        </button>
      </header>

      <section className="hero">
        <p className="eyebrow">TAKE BACK YOUR TIME</p>
        <h1>Block distractions.<br /><em>Stay focused.</em></h1>
        <p className="subtitle">Choose the websites you want available while you focus.</p>
      </section>

      <form className="block-form" onSubmit={addRule}>
          <label htmlFor="website">Websites you want access to</label>
        <div className="input-row">
          <div className="url-input">
            <input
              id="website"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
                placeholder="youtube.com"
              autoComplete="off"
            />
          </div>
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} aria-label="Block duration">
            {durations.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="block-button" type="submit">Allow site</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

      <section className="rules-section">
        <div className="section-heading mood-heading">
          <div>
            <p className="section-label">YOUR MOOD</p>
            <h2>{activeFolder?.name || 'Deep work'}</h2>
          </div>
          <div className="heading-actions">
            <span className="count">{activeRules.length}</span>
            <button className={blockingEnabled ? 'toggle-button active' : 'toggle-button'} type="button" onClick={toggleBlocking}>
              <span className="status-dot" />{blockingEnabled ? 'Stop blocking' : 'Start blocking'}
            </button>
          </div>
        </div>
        <div className="mood-tabs" aria-label="Choose a mood">
          {folders.map((folder) => (
            <div className={folder.id === activeFolderId ? 'mood-tab active' : 'mood-tab'} key={folder.id}>
              <button className="mood-select" type="button" onClick={() => selectFolder(folder.id)}>
                <span className="mood-dot" />{folder.name}<small>{folder.rules.filter((rule) => rule.expiresAt > now).length}</small>
              </button>
              <button className="delete-mood" type="button" onClick={() => removeFolder(folder.id)} aria-label={`Delete ${folder.name} mood`}>×</button>
            </div>
          ))}
          <form className="new-mood" onSubmit={addFolder}>
            <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="New mood" aria-label="New mood name" />
            <button type="submit" aria-label="Add mood">+</button>
          </form>
        </div>
        {activeRules.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✦</span>
            <p>Your focus list is clear.</p>
            <small>Add a website above. Every other website will be blocked.</small>
          </div>
        ) : (
          <div className="rules-list">
            {activeRules.map((rule) => (
              <article className="rule" key={rule.id}>
                <div className="site-icon">{rule.hostname.charAt(0).toUpperCase()}</div>
                <div className="rule-info">
                  <strong>{rule.displayUrl}</strong>
                  <span>Allowed · {formatRemaining(rule.expiresAt)}</span>
                </div>
                <button className="remove-button" type="button" onClick={() => removeRule(rule.id)} aria-label={`Unblock ${rule.displayUrl}`}>×</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer><span className={blockingEnabled ? 'status-dot' : 'status-dot paused'} /> {blockingEnabled ? 'Blocking is active on this browser' : 'Blocking is paused'}</footer>
    </main>
  )
}

export default App
