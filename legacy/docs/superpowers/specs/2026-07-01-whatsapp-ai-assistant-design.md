# WhatsApp AI Assistant — Design Spec

## Overview
Personal WhatsApp AI assistant running 24/7 on Arch Linux via systemd. Uses whatsapp-web.js for messaging, NVIDIA NIM API (OpenAI-compatible SDK) for AI responses, and Google Sheets for CRM logging.

## Architecture

```
whatsapp-web.js (LocalAuth) → Node.js (async) → NVIDIA NIM API (OpenAI SDK)
                                      ↕
                              Google Sheets API (logging)
```

## Components

### 1. WhatsApp Client (`src/whatsapp.js`)
- whatsapp-web.js with LocalAuth (session persists across restarts)
- Headless Puppeteer: `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-gpu`
- Message router: filters by chat type (DM vs group), sender (host vs others), and Away Mode state
- Built-in reconnect handling via whatsapp-web.js Client

### 2. AI Brain (`src/ai.js`)
- OpenAI-compatible SDK pointed at NVIDIA NIM API (`https://api.nim.blue/v1` — configurable)
- Query classifier: If message contains code-like patterns (code blocks, common coding keywords), route to coding model
- Coding model: `nvidia/llama-3.1-nemotron-70b-instruct`
- General model: `meta/llama-3.1-70b-instruct`
- Simple prefix-based system prompt per model type

### 3. State Manager (`src/state.js`)
- In-memory state: `awayMode` (boolean), `hostNumber` (string)
- Host sends `!away` from their registered number → toggles away mode
- Host messages are never auto-replied regardless of mode

### 4. Sheets Logger (`src/sheets.js`)
- googleapis package, JWT auth via service account
- Appends row: [ISO Timestamp, Sender ID (phone), User Message, AI Response]
- Fire-and-forget: failures log a warning, never block message flow

### 5. Entry Point (`index.js`)
- Loads dotenv
- Initializes Sheets auth, AI client, WhatsApp client
- Graceful shutdown on SIGTERM/SIGINT

### 6. Systemd Unit (`wa-ai.service`)
- Type=simple, runs index.js via node
- Restart=on-failure
- WantedBy=multi-user.target (Arch Linux)
- WorkingDirectory points to project root

## Away Mode State Machine
- Initial state: OFF
- `!away` from host → toggle (OFF→ON or ON→OFF)
- When ON:
  - DM from non-host → auto-reply
  - Everything else (groups, host messages) → ignore
- When OFF:
  - No auto-replies at all

## Error Handling
- Each module wraps its operations in try/catch
- WhatsApp client reconnect is native
- Sheets failures are logged, never propagated
- AI failures reply with a friendly error message to the user

## Files to Create
1. `package.json` — deps: whatsapp-web.js, openai, googleapis, dotenv
2. `.env.example` — template for all secrets
3. `index.js` — application entry point
4. `src/whatsapp.js` — WhatsApp client + message handling
5. `src/ai.js` — NVIDIA NIM routing logic
6. `src/state.js` — away mode state
7. `src/sheets.js` — Google Sheets logger
8. `wa-ai.service` — systemd unit file
9. `.gitignore`

## Constraints
- No excessive comments in code
- Clean async error handling
- Modular with single-responsibility files
- Minimal dependencies
