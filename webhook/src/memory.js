const MEMORY_LIMIT = 10
const store = new Map()

export function addMessage(phone, role, content) {
  if (!store.has(phone)) {
    store.set(phone, [])
  }
  const history = store.get(phone)
  history.push({ role, content })
  if (history.length > MEMORY_LIMIT) {
    history.splice(0, history.length - MEMORY_LIMIT)
  }
}

export function getHistory(phone) {
  return store.get(phone) || []
}

export function formatHistory(phone) {
  const messages = getHistory(phone)
  if (messages.length === 0) return ''
  return messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')
}
