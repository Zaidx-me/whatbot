# Activity Dashboard — Design Spec

## Overview
Real-time web dashboard for the WhatsApp AI assistant. Shows live message logs, away mode status, and message stats. Runs alongside the main bot process via an embedded Express server.

## Architecture

```
src/whatsapp.js (emits events) → EventEmitter → server.js (Express + SSE)
                                                    ↕
                                              public/index.html (vanilla JS)
```

## Components

### server.js
- Express server on port 3000
- `GET /` — serves dashboard HTML
- `GET /events` — SSE endpoint, pushes `{type, timestamp, sender, message, response, error}` events
- `GET /status` — returns `{awayMode: bool}` JSON
- In-memory buffer of last 100 events for late connections
- CORS disabled (local only)

### public/index.html
- Single-file, no build step
- Table: Timestamp | Sender | Message | Response
- Away mode status badge (ON=green, OFF=gray)
- Auto-scrolls to latest entry
- Connects to `/events` via EventSource
- Polls `/status` every 2s for away state

### src/whatsapp.js changes
- Import EventEmitter singleton
- Emit `message` events: `{type: 'message', timestamp, sender, message, response}`
- Emit `error` events: `{type: 'error', timestamp, sender, message, error}`
- Emit `away` events: `{type: 'away', enabled}`

### index.js changes
- Start Express server after WhatsApp client is ready
- Fix AI error handling (log full error, reply with informative message)

### src/ai.js changes
- Add user-friendly error message when NVIDIA API fails
- Log model name and error details

## Bot Fix
The bot not replying is likely because `getReply()` throws (API issue), and the catch block's fallback reply also fails silently. Fix: log the actual API error details to console, ensure fallback reply is more robust.

## Files
- Create: `server.js`
- Create: `public/index.html`
- Modify: `src/whatsapp.js`
- Modify: `src/ai.js`
- Modify: `index.js`
- Modify: `package.json` (add express)
