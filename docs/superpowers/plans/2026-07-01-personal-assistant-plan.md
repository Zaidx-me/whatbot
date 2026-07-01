# Personal AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the WhatsApp AI bot into a personalized "Jarvis" with per-user profiles and conversation memory.

**Architecture:** A profiles JSON file stores user personas keyed by phone number. An in-memory module tracks recent messages per user. The webhook handler loads the matching profile and recent history before each AI call, building a personalized system prompt.

**Tech Stack:** Node.js 22, Express, native ES modules

## Global Constraints

- All env vars (`NVIDIA_API_KEY`, `WHATSAPP_BASE_URL`, `WHATSAPP_API_KEY`) are already set on Railway
- OpenAI SDK v4.80+ with `timeout: 60000, maxRetries: 0` on constructor
- Models: `mistralai/codestral-22b-instruct-v0.1` (coding), `meta/llama-3.1-8b-instruct` (general)
- Railway ephemeral filesystem — profiles are in code, memory is in-memory

---

### Task 1: Create `profiles.json`

**Files:**
- Create: `webhook/src/profiles.json`

**Interfaces:**
- Produces: `profiles.json` — JSON object keyed by WhatsApp ID (`923296585597@c.us`), each value has `{ name, persona, instructions }`

- [ ] **Create the profiles file**

```json
{
  "923296585597@c.us": {
    "name": "Zaid",
    "persona": {
      "identity": {
        "full_name": "Muhammad Zaid Yaseen",
        "location": "Lahore, Pakistan",
        "profession": ["Developer", "UI/UX Designer"],
        "education": {
          "institution": "University of the Punjab (Gujranwala Campus)",
          "degree": "Information Technology",
          "milestones": [
            "Started 2nd semester in mid-2025",
            "Honhaar Scholarship recipient"
          ]
        }
      },
      "technical_stack": {
        "languages": ["C++", "8086 Assembly", "TypeScript"],
        "frameworks_and_libraries": ["React Native", "SFML", "Firebase"],
        "design_tools": ["Figma", "Adobe Photoshop"],
        "operating_systems": ["Arch Linux", "CachyOS"],
        "environment": {
          "window_managers": ["Hyprland", "Niri"],
          "workflow": "Custom Unixporn-style ricing, optimized minimalist desktop environments"
        }
      },
      "aesthetic_and_vibe": {
        "visual_preference": "Dark, moody, and minimalist",
        "branding": "Cybersecurity-themed, heavily inspired by 'Mr. Robot' and hacker culture",
        "communication_style": "Direct, technical, pragmatic, and highly focused on system optimization"
      },
      "core_projects": [
        {
          "name": "Zesho",
          "type": "Mobile Application",
          "stack": ["React Native", "TypeScript", "Firebase"],
          "description": "A resource-sharing app designed for students to host and access university books and notes."
        },
        {
          "name": "UniNav",
          "type": "Console Application",
          "stack": ["C++"],
          "description": "Campus navigation and management system built focusing on Data Structures and Algorithms."
        },
        {
          "name": "Tank 1990 Clone",
          "type": "Game Development",
          "stack": ["C++", "SFML"],
          "description": "Procedural game clone built under strict constraints (avoiding OOP and dynamic containers)."
        },
        {
          "name": "Intellichat",
          "type": "AI Integration",
          "stack": ["AI"],
          "description": "An AI-integrated assignment and resume builder application."
        }
      ],
      "digital_assets": {
        "personal_domain": "zaidx.me"
      },
      "personal_interests": {
        "sports": ["Mixed Martial Arts (MMA)"],
        "games": ["Competitive Chess (Chess.com ranking focus)"],
        "media": ["Mr. Robot"]
      },
      "relationships_and_life": {
        "family": ["Younger brother", "Father (Baba)"],
        "goals": ["Mastering low-level programming", "Scaling mobile apps", "Perfecting Linux workflows"]
      }
    },
    "instructions": "You are Jarvis — Zaid's personal AI assistant. Be direct, technical, and hacker-culture inspired (think Mr. Robot vibe). Reference Zaid's projects (Zesho, UniNav, Tank 1990, Intellichat) when relevant. Keep responses concise but insightful. Address him as Zaid. Use a dark, minimalist tone — no fluff, no emojis."
  }
}
```

- [ ] **Commit**

```bash
git add webhook/src/profiles.json
git commit -m "feat: add personal profile for Zaid"
```

---

### Task 2: Create `memory.js` — Conversation Memory Module

**Files:**
- Create: `webhook/src/memory.js`

**Interfaces:**
- Consumes: no deps
- Produces: `{ addMessage(phone, role, content), getHistory(phone) }`

- [ ] **Create memory.js**

```js
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
```

- [ ] **Commit**

```bash
git add webhook/src/memory.js
git commit -m "feat: add in-memory conversation history module"
```

---

### Task 3: Modify `index.js` — Wire Profiles + Memory

**Files:**
- Modify: `webhook/src/index.js`

**Interfaces:**
- Consumes: `profiles.json` (default import), `memory.js` (addMessage, getHistory, formatHistory)
- Produces: Personalized AI replies with context

- [ ] **Add imports and load profiles**

Add after the existing imports:
```js
import { addMessage, formatHistory } from './memory.js'
import profiles from './profiles.json' with { type: 'json' }
```

- [ ] **Replace the getReply function**

Replace the entire `getReply` function:
```js
async function getReply(message, phone) {
  const profile = profiles[phone]
  const isCoding = isCodingQuery(message)

  let messages = []

  if (profile) {
    const history = formatHistory(phone)
    const systemParts = [
      `You are Jarvis, an AI personal assistant for ${profile.name}.`,
      profile.instructions,
      ``,
      `USER PROFILE:`,
      JSON.stringify(profile.persona, null, 2),
    ]
    if (history) {
      systemParts.push('', `RECENT CONVERSATION:`, history)
    }
    messages.push({ role: 'system', content: systemParts.join('\n') })
  } else {
    const system = isCoding
      ? 'You are a helpful coding assistant. Provide concise, correct answers.'
      : 'You are a helpful assistant. Be friendly and concise.'
    messages.push({ role: 'system', content: system })
  }

  messages.push({ role: 'user', content: message })

  const model = isCoding ? CODING_MODEL : GENERAL_MODEL
  console.log(`[webhook] getReply model=${model} phone=${phone} profile=${!!profile}`)

  const completion = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: 512,
    temperature: 0.7,
  })
  const content = completion.choices[0]?.message?.content
  if (!content) return 'Sorry, I got an empty response from the AI.'
  return content.trim()
}
```

- [ ] **Update the webhook handler to pass phone**

In the webhook POST handler, change the `getReply` call:
```js
getReply(messageBody, data.from).then(async (reply) => {
```

And add memory saving after successful reply. Change the `.then()` block:
```js
getReply(messageBody, data.from).then(async (reply) => {
    addMessage(data.from, 'user', messageBody)
    addMessage(data.from, 'assistant', reply)
    console.log(`[webhook] AI reply to ${data.from}: ${reply.slice(0, 80)}`)
    // ... rest of send logic unchanged ...
```

- [ ] **Verify the full file compiles**

Run: `node --check webhook/src/index.js`
Expected: no errors

- [ ] **Commit**

```bash
git add webhook/src/index.js
git commit -m "feat: wire profiles and conversation memory into webhook handler"
```

- [ ] **Push to deploy**

```bash
git push
```
