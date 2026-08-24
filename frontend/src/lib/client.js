import { initClient } from 'trailbase'

const LS_TOKENS = 'timekeeper_tokens'

function loadTokens() {
  try { return JSON.parse(localStorage.getItem(LS_TOKENS)) || undefined } catch { return undefined }
}

export const client = initClient('http://localhost:47400', {
  tokens: loadTokens(),
  onAuthChange: (c) => {
    const tokens = c.tokens()
    if (tokens) localStorage.setItem(LS_TOKENS, JSON.stringify(tokens))
    else localStorage.removeItem(LS_TOKENS)
  }
})

export async function waitForServer(timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch('http://localhost:47400/api/healthz', { signal: AbortSignal.timeout(1000) })
      if (r.ok || r.status === 404) return true
    } catch {
      // Ignore transient connection failures while the local backend starts.
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return false
}
