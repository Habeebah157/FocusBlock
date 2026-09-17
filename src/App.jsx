import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'website-blocker-rules'
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

function readRules() {
  const api = extensionApi()
  if (api) {
    return new Promise((resolve) => {
      api.storage.local.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY] || []))
    })
  }

  try {
    return Promise.resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
  } catch {
    return Promise.resolve([])
  }
}

async function saveRules(rules) {
  const api = extensionApi()
  if (api) {
    await new Promise((resolve, reject) => {
      api.storage.local.set({ [STORAGE_KEY]: rules }, () => {
        if (api.runtime.lastError) {
          reject(new Error(api.runtime.lastError.message))
          return
        }
        resolve()
      })
    })
    await new Promise((resolve, reject) => {
      api.runtime.sendMessage({ type: 'SYNC_BLOCKERS', blockers: rules }, (response) => {
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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}

function App() {
  const [rules, setRules] = useState([])
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    readRules().then((storedRules) => {
      const activeRules = storedRules.filter((rule) => rule.expiresAt > Date.now())
      setRules(activeRules)
      if (activeRules.length !== storedRules.length) {
        saveRules(activeRules).catch((saveError) => setError(saveError.message))
      }
    })
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const activeRules = useMemo(
    () => rules.filter((rule) => rule.expiresAt > now),
    [rules, now],
  )

  function addRule(event) {
    event.preventDefault()
    setError('')

    try {
      const { displayUrl, hostname } = normalizeUrl(url)
      if (activeRules.some((rule) => rule.hostname === hostname)) {
        setError('That website is already blocked.')
        return
      }

      const rule = {
        id: crypto.randomUUID(),
        hostname,
        displayUrl,
        expiresAt: Date.now() + duration * 60000,
      }
      const nextRules = [...activeRules, rule]
      setRules(nextRules)
      saveRules(nextRules).catch((saveError) => setError(saveError.message))
      setUrl('')
    } catch {
      setError('Enter a valid website address, like youtube.com.')
    }
  }

  function removeRule(id) {
    const nextRules = activeRules.filter((rule) => rule.id !== id)
    setRules(nextRules)
    saveRules(nextRules).catch((saveError) => setError(saveError.message))
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
        <p className="subtitle">Add a website and choose how long you want it out of reach.</p>
      </section>

      <form className="block-form" onSubmit={addRule}>
        <label htmlFor="website">Website to block</label>
        <div className="input-row">
          <div className="url-input">
            <input
              id="website"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtube.com"
              autoComplete="off"
            />
          </div>
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value))} aria-label="Block duration">
            {durations.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="block-button" type="submit">Block site</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>

      <section className="rules-section">
        <div className="section-heading">
          <h2>Currently blocked</h2>
          <span className="count">{activeRules.length}</span>
        </div>
        {activeRules.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✦</span>
            <p>Your focus list is clear.</p>
            <small>Add a website above to get started.</small>
          </div>
        ) : (
          <div className="rules-list">
            {activeRules.map((rule) => (
              <article className="rule" key={rule.id}>
                <div className="site-icon">{rule.hostname.charAt(0).toUpperCase()}</div>
                <div className="rule-info">
                  <strong>{rule.displayUrl}</strong>
                  <span>Blocked · {formatRemaining(rule.expiresAt)}</span>
                </div>
                <button className="remove-button" type="button" onClick={() => removeRule(rule.id)} aria-label={`Unblock ${rule.displayUrl}`}>×</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer><span className="status-dot" /> Blocking is active on this browser</footer>
    </main>
  )
}

export default App
