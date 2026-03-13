import { initClient } from 'trailbase'

const LS_TOKENS = 'timekeeper_tokens'

function loadTokens() {
  try { return JSON.parse(localStorage.getItem(LS_TOKENS)) || undefined } catch { return undefined }
}

export const client = initClient('http://localhost:4000', {
  tokens: loadTokens(),
  onAuthChange: (c) => {
    const tokens = c.tokens()
    if (tokens) localStorage.setItem(LS_TOKENS, JSON.stringify(tokens))
    else localStorage.removeItem(LS_TOKENS)
  }
})
