# Personal AI Assistant — Design Spec

## Goal
Turn the WhatsApp AI bot into a personalized "Jarvis" that knows the user's identity, projects, tone, and preferences, with conversation memory. Built to support multiple users.

## Architecture

### Current
```
WhatsApp → whatbot → webhook (single handler) → NVIDIA AI → reply
```

### Target
```
WhatsApp (User A) → whatbot → webhook → identify user by phone → 
  load profile → inject persona + history → NVIDIA AI → reply → save to memory
```

## Components

### 1. `profiles.json` — User Profile Store
Path: `webhook/src/profiles.json`

Keyed by WhatsApp ID (`number@c.us`). Loaded once at startup.

```json
{
  "923296585597@c.us": {
    "name": "Zaid",
    "persona": { ... },
    "instructions": "Direct, technical, hacker-culture inspired. Reference Zaid's projects when relevant. Keep responses concise but insightful."
  }
}
```

Fields:
- `name` — How the AI addresses the user
- `persona` — Full JSON blob (identity, tech stack, projects, interests)
- `instructions` — Tone/style/behavior directives

### 2. `memory.js` — Conversation Memory
Path: `webhook/src/memory.js`

Exports:
- `addMessage(phone, role, content)` — Store a message
- `getHistory(phone)` — Get last N messages
- `MEMORY_LIMIT` — Configurable (default 10 exchanges)

Implementation: In-memory `Map<string, Array<{role, content}>>`. Oldest entries dropped when limit exceeded. Lost on restart (acceptable).

### 3. `index.js` — Modified Handler
Path: `webhook/src/index.js`

Changes:
- Import `profiles.json` and `memory.js`
- On `message.received`:
  1. Extract sender phone from `data.from`
  2. Look up profile in `profiles.json`
  3. If found: build personalized system prompt with persona + instructions + recent history
  4. If not found: use default generic prompt (for future users)
  5. Call AI with context
  6. Save exchange to memory
  7. Send reply

## System Prompt Builder

Pseudo:
```
You are an AI personal assistant for {name}.
{instructions}

USER PROFILE:
{JSON.stringify(persona)}

RECENT CONVERSATION:
{history formatted as messages}

Respond naturally as {name}'s assistant.
```

## Multi-User Support

Adding a new user is a config change:
1. Add entry to `profiles.json` with their phone number
2. Push to GitHub → Railway auto-deploys
3. They message the bot → matched by phone → their profile loaded

Unmatched phone numbers get a generic assistant (no persona).

## Constraints
- Railway ephemeral filesystem: profiles are embedded in code, memory is in-memory
- Max conversation memory: 10 exchanges per user (configurable)
- Token budget: profile ~400 tokens + history ~500 tokens → well within context limits
