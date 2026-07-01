# Activity Dashboard Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement task-by-task.

**Goal:** Real-time web dashboard showing message logs, away mode status, and fixing bot reply failure.

**Architecture:** Express server with SSE pushes events from the bot to a single-page HTML dashboard. EventEmitter connects whatsapp.js to server.js.

**Tech Stack:** express, server-sent-events, vanilla HTML/JS, EventEmitter

## Global Constraints

- Dashboard on port 3000 (configurable via `DASHBOARD_PORT` env var)
- No build tools — single HTML file
- SSE for real-time updates, `/status` JSON endpoint for away mode
- Bot fix: log full NVIDIA API errors, emit error events to dashboard

---

### Task 1: Add express dependency + create server.js

**Files:**
- Modify: `package.json`
- Create: `server.js`

- [ ] **Step 1: Add express to package.json**

Run: `npm install express`

- [ ] **Step 2: Create server.js**

```js
import express from 'express'
import { EventEmitter } from 'events'

export const bus = new EventEmitter()
const events = []
const MAX_EVENTS = 100

let awayMode = false

bus.on('away', (enabled) => { awayMode = enabled })

export function startServer(port = 3000) {
  const app = express()

  app.get('/status', (_, res) => {
    res.json({ awayMode })
  })

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    for (const e of events) {
      res.write(`data: ${JSON.stringify(e)}\n\n`)
    }

    const handler = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    bus.on('event', handler)
    req.on('close', () => bus.off('event', handler))
  })

  app.use(express.static('public'))

  app.listen(port, () => console.log(`Dashboard: http://localhost:${port}`))
}

export function pushEvent(data) {
  events.push(data)
  if (events.length > MAX_EVENTS) events.shift()
  bus.emit('event', data)
}
```

---

### Task 2: Create dashboard HTML

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WhatsApp AI — Activity</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, sans-serif; background: #111; color: #e0e0e0; padding: 20px; }
h1 { font-size: 1.2rem; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
#away-badge { font-size: 0.7rem; padding: 3px 10px; border-radius: 20px; font-weight: 600; }
#away-badge.on { background: #16a34a; color: #fff; }
#away-badge.off { background: #444; color: #999; }
table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2a2a2a; }
th { background: #1a1a1a; color: #888; font-weight: 500; position: sticky; top: 0; }
td { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td.error { color: #ef4444; }
tr:hover { background: #1e1e1e; }
#log { max-height: 80vh; overflow-y: auto; border: 1px solid #2a2a2a; border-radius: 8px; }
.timestamp { color: #666; white-space: nowrap; }
.sender { color: #93c5fd; }
.msg { color: #e0e0e0; }
.response { color: #86efac; }
</style>
</head>
<body>
<h1>WhatsApp AI Activity <span id="away-badge" class="off">AWAY OFF</span></h1>
<div id="log">
<table><thead><tr><th>Time</th><th>Sender</th><th>Message</th><th>Response</th></tr></thead><tbody id="tbody"></tbody></table>
</div>
<script>
const tbody = document.getElementById('tbody')
const badge = document.getElementById('away-badge')

const evtSource = new EventSource('/events')
evtSource.onmessage = (e) => {
  const d = JSON.parse(e.data)
  if (d.type === 'away') {
    badge.textContent = d.enabled ? 'AWAY ON' : 'AWAY OFF'
    badge.className = d.enabled ? 'on' : 'off'
    return
  }
  const tr = document.createElement('tr')
  const ts = new Date(d.timestamp).toLocaleTimeString()
  tr.innerHTML = `<td class="timestamp">${ts}</td><td class="sender">${esc(d.sender)}</td><td class="msg">${esc(d.message)}</td><td class="${d.error ? 'error' : 'response'}">${esc(d.response || d.error || '...')}</td>`
  tbody.prepend(tr)
}

setInterval(async () => {
  const r = await fetch('/status')
  const s = await r.json()
  badge.textContent = s.awayMode ? 'AWAY ON' : 'AWAY OFF'
  badge.className = s.awayMode ? 'on' : 'off'
}, 2000)

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
</script>
</body>
</html>
```

---

### Task 3: Update whatsapp.js to emit events

**Files:**
- Modify: `src/whatsapp.js`

- [ ] **Step 1: Update src/whatsapp.js**

```js
import { isAway, toggleAway } from './state.js'
import { getReply } from './ai.js'
import { logInteraction } from './sheets.js'
import { pushEvent } from '../server.js'

export function setup(client) {
  client.on('message', async (msg) => {
    const sender = msg.author || msg.from
    try {
      const chat = await msg.getChat()
      if (chat.isGroup) return

      if (msg.body.trim() === '!away') {
        const now = toggleAway()
        pushEvent({ type: 'away', enabled: now })
        await msg.reply(`Away mode is now ${now ? 'ON' : 'OFF'}`)
        return
      }

      if (msg.body.startsWith('!')) return
      if (!isAway()) return

      console.log('AI request from', sender, ':', msg.body)
      const reply = await getReply(msg.body)
      console.log('AI response:', reply)

      await msg.reply(reply)

      pushEvent({ type: 'message', timestamp: new Date().toISOString(), sender, message: msg.body, response: reply })
      logInteraction(new Date().toISOString(), sender, msg.body, reply)
    } catch (err) {
      console.error('Message handler error:', err.message)
      pushEvent({ type: 'message', timestamp: new Date().toISOString(), sender, message: msg.body, error: err.message })
      try {
        await msg.reply('Sorry, I ran into an issue processing your message.')
      } catch (_) {}
    }
  })
}
```

---

### Task 4: Fix AI error handling + update index.js

**Files:**
- Modify: `src/ai.js`
- Modify: `index.js`

- [ ] **Step 1: Update src/ai.js — better error logging**

```js
import OpenAI from 'openai'

const CODING_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
const GENERAL_MODEL = 'meta/llama-3.3-70b-instruct'
const CODING_KEYWORDS = ['```', 'function', 'class ', 'def ', 'import ', 'const ', 'let ', 'var ', '=>', 'console.log', '#include', 'npm ', 'git ', 'code', 'bug', 'error', 'debug', 'compile', 'syntax', 'algorithm', 'api']

function isCodingQuery(text) {
  const lower = text.toLowerCase()
  return CODING_KEYWORDS.some(kw => lower.includes(kw))
}

let client

export function init() {
  client = new OpenAI({
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  })
}

export async function getReply(message) {
  const isCoding = isCodingQuery(message)
  const model = isCoding ? CODING_MODEL : GENERAL_MODEL
  const system = isCoding
    ? 'You are a helpful coding assistant. Provide concise, correct answers.'
    : 'You are a helpful assistant. Be friendly and concise.'

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      max_tokens: 1024,
      temperature: 0.7,
      timeout: 30000,
    })

    return completion.choices[0].message.content.trim()
  } catch (err) {
    console.error('NVIDIA API error:', err.status, err.message)
    if (err.status === 401) throw new Error('NVIDIA API key is invalid or expired')
    if (err.status === 404) throw new Error(`Model "${model}" not found at NVIDIA NIM`)
    if (err.code === 'ETIMEDOUT') throw new Error('NVIDIA API timed out — check network')
    throw new Error(`AI error: ${err.message}`)
  }
}
```

- [ ] **Step 2: Update index.js — start server**

```js
import 'dotenv/config'
import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
const { Client, LocalAuth } = pkg
import { init as initAI } from './src/ai.js'
import { init as initSheets } from './src/sheets.js'
import { setup as setupWhatsApp } from './src/whatsapp.js'
import { startServer } from './server.js'

initAI()
initSheets()

const client = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: { type: 'none' },
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
})

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('WhatsApp AI Assistant is ready')
  startServer(process.env.DASHBOARD_PORT || 3000)
})

client.on('auth_failure', (msg) => console.error('Auth failure:', msg))
client.on('disconnected', (reason) => console.warn('Disconnected:', reason))

setupWhatsApp(client)
client.initialize()

process.on('SIGTERM', () => client.destroy())
process.on('SIGINT', () => client.destroy())
```

---

### Task 5: Install + verify

- [ ] **Step 1: Install express**

Run: `npm install express`

- [ ] **Step 2: Verify syntax**

Run: `node --check server.js && node --check index.js && node --check src/whatsapp.js && node --check src/ai.js`

- [ ] **Step 3: Test dashboard start**

Run: `node server.js` (should start on port 3000)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: activity dashboard with SSE + fix AI error handling"
```
