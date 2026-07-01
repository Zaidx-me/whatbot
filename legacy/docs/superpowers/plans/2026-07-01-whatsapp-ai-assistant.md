# WhatsApp AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personal WhatsApp AI assistant with NVIDIA NIM brains, Google Sheets CRM, running 24/7 on Arch Linux via systemd.

**Architecture:** whatsapp-web.js (LocalAuth) receives messages → Node.js routes to NVIDIA NIM (OpenAI SDK) → replies via WhatsApp → logs to Google Sheets.

**Tech Stack:** whatsapp-web.js, openai, googleapis, dotenv, Node.js, systemd

## Global Constraints

- Headless Puppeteer args: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
- Away mode: toggled only by host via `!away`, only auto-replies to DMs when ON
- Sheets logging: [Timestamp, Sender ID, User Message, AI Response] appended per reply
- No excessive comments in code
- NVIDIA NIM endpoint: `https://api.nim.blue/v1` (configurable via env)
- Coding model: `nvidia/llama-3.1-nemotron-70b-instruct`
- General model: `meta/llama-3.1-70b-instruct`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "whatsapp-ai-assistant",
  "version": "1.0.0",
  "description": "Personal WhatsApp AI assistant with NVIDIA NIM brains",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "whatsapp-web.js": "^1.26.0",
    "openai": "^4.73.0",
    "googleapis": "^140.0.0",
    "dotenv": "^16.4.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
HOST_NUMBER=1234567890@c.us
NVIDIA_API_KEY=your_nvidia_nim_api_key
NVIDIA_BASE_URL=https://api.nim.blue/v1
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_SHEET_ID=your_google_sheet_id
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
.wwebjs_auth/
.wwebjs_cache/
```

---

### Task 2: State Manager (`src/state.js`)

**Files:**
- Create: `src/state.js`

**Interfaces:**
- Produces: `{ awayMode, hostNumber, toggleAway(), isHost() }`

- [ ] **Step 1: Create src/state.js**

```js
let awayMode = false
let hostNumber = ''

export function init(host) {
  hostNumber = host
  awayMode = false
}

export function toggleAway() {
  awayMode = !awayMode
  return awayMode
}

export function isAway() {
  return awayMode
}

export function isHost(sender) {
  return sender === hostNumber
}
```

---

### Task 3: AI Brain (`src/ai.js`)

**Files:**
- Create: `src/ai.js`

**Interfaces:**
- Consumes: `process.env.NVIDIA_API_KEY`, `process.env.NVIDIA_BASE_URL`
- Produces: `{ getReply(message) }`

- [ ] **Step 1: Create src/ai.js**

```js
import OpenAI from 'openai'

const CODING_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
const GENERAL_MODEL = 'meta/llama-3.1-70b-instruct'
const CODING_KEYWORDS = ['```', 'function', 'class ', 'def ', 'import ', 'const ', 'let ', 'var ', '=>', 'console.log', '#include', 'npm ', 'git ', 'code', 'bug', 'error', 'debug', 'compile', 'syntax', 'algorithm', 'api']

function isCodingQuery(text) {
  const lower = text.toLowerCase()
  return CODING_KEYWORDS.some(kw => lower.includes(kw))
}

let client

export function init() {
  client = new OpenAI({
    baseURL: process.env.NVIDIA_BASE_URL || 'https://api.nim.blue/v1',
    apiKey: process.env.NVIDIA_API_KEY,
  })
}

export async function getReply(message) {
  const model = isCodingQuery(message) ? CODING_MODEL : GENERAL_MODEL
  const system = isCodingQuery(message)
    ? 'You are a helpful coding assistant. Provide concise, correct answers.'
    : 'You are a helpful assistant. Be friendly and concise.'

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    max_tokens: 1024,
    temperature: 0.7,
  })

  return completion.choices[0].message.content.trim()
}
```

---

### Task 4: Sheets Logger (`src/sheets.js`)

**Files:**
- Create: `src/sheets.js`

**Interfaces:**
- Consumes: `process.env.GOOGLE_*` env vars
- Produces: `{ logInteraction(timestamp, sender, userMessage, aiResponse) }`

- [ ] **Step 1: Create src/sheets.js**

```js
import { google } from 'googleapis'

let sheets
let sheetId

export function init() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  sheets = google.sheets({ version: 'v4', auth })
  sheetId = process.env.GOOGLE_SHEET_ID
}

export async function logInteraction(timestamp, sender, userMessage, aiResponse) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, sender, userMessage, aiResponse]],
      },
    })
  } catch (err) {
    console.warn('Sheets log failed:', err.message)
  }
}
```

---

### Task 5: WhatsApp Client (`src/whatsapp.js`)

**Files:**
- Create: `src/whatsapp.js`

**Interfaces:**
- Consumes: `state` (from `src/state.js`), `getReply` (from `src/ai.js`), `logInteraction` (from `src/sheets.js`)
- Produces: `{ start(client) }` — sets up message handler on the whatsapp-web.js client

- [ ] **Step 1: Create src/whatsapp.js**

```js
import { isAway, isHost } from './state.js'
import { getReply } from './ai.js'
import { logInteraction } from './sheets.js'

import { isAway, isHost, toggleAway } from './state.js'
import { getReply } from './ai.js'
import { logInteraction } from './sheets.js'

export function setup(client) {
  client.on('message', async (msg) => {
    try {
      const chat = await msg.getChat()
      const sender = msg.author || msg.from

      if (chat.isGroup) return

      if (isHost(sender) && msg.body.trim() === '!away') {
        const now = toggleAway()
        await msg.reply(`Away mode is now ${now ? 'ON' : 'OFF'}`)
        return
      }

      if (isHost(sender)) return
      if (!isAway()) return
      if (msg.body.startsWith('!')) return

      const reply = await getReply(msg.body)

      await msg.reply(reply)

      logInteraction(
        new Date().toISOString(),
        sender,
        msg.body,
        reply
      )
    } catch (err) {
      console.error('Message handler error:', err.message)
      try {
        await msg.reply('Sorry, I ran into an issue processing your message.')
      } catch (_) {}
    }
  })
}
```

---

### Task 6: Entry Point (`index.js`)

**Files:**
- Create: `index.js`

- [ ] **Step 1: Create index.js**

```js
import 'dotenv/config'
import { Client, LocalAuth } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import { init as initState } from './src/state.js'
import { init as initAI } from './src/ai.js'
import { init as initSheets } from './src/sheets.js'
import { setup as setupWhatsApp } from './src/whatsapp.js'

initState(process.env.HOST_NUMBER)
initAI()
initSheets()

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
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
})

setupWhatsApp(client)

client.initialize()

process.on('SIGTERM', () => client.destroy())
process.on('SIGINT', () => client.destroy())
```

---

### Task 7: systemd Service (`wa-ai.service`)

**Files:**
- Create: `wa-ai.service`

- [ ] **Step 1: Create wa-ai.service**

```
[Unit]
Description=WhatsApp AI Assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/whatsapp-ai
ExecStart=/usr/bin/node /path/to/whatsapp-ai/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

### Task 8: Install & Verify

- [ ] **Step 1: Install dependencies**

Run: `npm install`

- [ ] **Step 2: Create .env from example**

Run: `cp .env.example .env`, then fill in secrets.

- [ ] **Step 3: Start the bot**

Run: `node index.js`

- [ ] **Step 4: Scan QR code** with WhatsApp to link session.

- [ ] **Step 5: Install systemd service** (as root):
```
sudo cp wa-ai.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable wa-ai.service
sudo systemctl start wa-ai.service
```
