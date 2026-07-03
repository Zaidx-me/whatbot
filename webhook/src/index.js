import OpenAI from 'openai'
import express from 'express'
import { addMessage, formatHistory } from './memory.js'
import profiles from './profiles.json' with { type: 'json' }

// GLM-5.2 holds persona/instruction-following much better across a conversation
// than DiffusionGemma right now, which matters more here than raw speed.
// If you want to split traffic again later, swap CODING_MODEL back to
// diffusiongemma for latency — coding answers lean less on persona anyway.
const CODING_MODEL = 'gemini-2.5-flash'
const GENERAL_MODEL = 'gemini-2.5-flash'
const CODING_KEYWORDS = ['```', 'function', 'class ', 'def ', 'import ', 'const ', 'let ', 'var ', '=>', 'console.log', '#include', 'npm ', 'git ', 'code', 'bug', 'error', 'debug', 'compile', 'syntax', 'algorithm', 'api']

function isCodingQuery(text) {
  const lower = text.toLowerCase()
  return CODING_KEYWORDS.some(kw => lower.includes(kw))
}

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
let WHATSAPP_BASE_URL = process.env.WHATSAPP_BASE_URL
if (WHATSAPP_BASE_URL && !WHATSAPP_BASE_URL.startsWith('http')) WHATSAPP_BASE_URL = 'https://' + WHATSAPP_BASE_URL
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY
const PORT = parseInt(process.env.PORT || '3000', 10)

const openai = new OpenAI({ baseURL: GOOGLE_BASE_URL, apiKey: GOOGLE_API_KEY, timeout: 120000, maxRetries: 0 })

// Concurrency limiter — max 3 concurrent AI requests to avoid NVIDIA rate limits
let activeRequests = 0
const MAX_CONCURRENT = 3
const requestQueue = []

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeRequests++
      try { resolve(await fn()) } catch (e) { reject(e) } finally {
        activeRequests--
        if (requestQueue.length > 0) requestQueue.shift()()
      }
    }
    if (activeRequests < MAX_CONCURRENT) run()
    else requestQueue.push(run)
  })
}

const app = express()
app.use(express.json())

function buildSystemPrompt(profile, history) {
  const parts = [
    `You are Zaid. You are not playing a character or mimicking a personality — you ARE Zaid, replying to your own WhatsApp in first person. Never describe yourself in third person, never refer to "the personality" or "the profile" — that context below is just your own life, not a script.`,
    profile.instructions,
    ``,
    `WHO YOU ARE:`,
    JSON.stringify(profile.persona, null, 2),
  ]

  if (profile.voice_rules) {
    parts.push('', `HOW YOU TEXT (follow exactly):`, JSON.stringify(profile.voice_rules, null, 2))
  }

  if (profile.few_shot_examples) {
    parts.push('', `EXAMPLES OF HOW YOU REPLY IN DIFFERENT SITUATIONS — match this style, don't reuse the literal lines:`, JSON.stringify(profile.few_shot_examples, null, 2))
  }

  parts.push(
    '',
    `FORMAT: If your reply is more than one thought, separate each bubble with "|||" (e.g. "Hn|||abhi busy hn|||thori dr mein batata hn"). Do not use "|||" for anything else. Most replies should be 1-3 short bubbles, not one paragraph.`
  )

  if (history) parts.push('', `RECENT CONVERSATION:`, history)

  return parts.join('\n')
}

async function getReply(message, phone) {
  const profile = profiles[phone]
  console.log(`[webhook] profile lookup phone="${phone}" found=${!!profile} keys=${JSON.stringify(Object.keys(profiles))}`)
  const isCoding = isCodingQuery(message)
  const model = isCoding ? CODING_MODEL : GENERAL_MODEL

  const systemMessages = []
  if (profile) {
    const history = formatHistory(phone)
    systemMessages.push({ role: 'system', content: buildSystemPrompt(profile, history) })
  } else {
    const system = isCoding
      ? 'You are master of coding Zaid. Provide concise, correct answers.'
      : 'You are a intelligent Zaid. Be friendly and concise.'
    systemMessages.push({ role: 'system', content: system })
  }

  systemMessages.push({ role: 'user', content: message })

  console.log(`[webhook] getReply model=${model} phone=${phone} profile=${!!profile}`)

  const completion = await openai.chat.completions.create({
    model,
    messages: systemMessages,
    max_tokens: isCoding ? 16384 : 16384,
    temperature: isCoding ? 1 : 1,
    // Nudges the model off generic high-probability filler like
    // "How can I help you today?" — only apply on the persona path.
    ...(isCoding ? {} : { frequency_penalty: 0.4 }),
  })
  const content = completion.choices[0]?.message?.content
  if (!content) return 'I will contact you later. I\'m not available right now.  '
  return content.trim()
}

// Splits a "|||"-delimited reply into individual WhatsApp bubbles.
// Falls back to splitting on blank-line paragraph breaks if the model
// ignored the delimiter instruction and just wrote normal paragraphs.
function splitBubbles(reply) {
  if (reply.includes('|||')) {
    return reply.split('|||').map(s => s.trim()).filter(Boolean)
  }
  const byParagraph = reply.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  return byParagraph.length > 1 ? byParagraph : [reply.trim()]
}

async function sendBubbles(sendUrl, apiKey, chatId, bubbles) {
  for (let i = 0; i < bubbles.length; i++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const resp = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ chatId, text: bubbles[i] }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        console.error(`[webhook] whatbot API error ${resp.status}: ${errText}`)
      }
    } finally {
      clearTimeout(timeout)
    }
    // Small human-like gap between bubbles, skip after the last one
    if (i < bubbles.length - 1) await new Promise(r => setTimeout(r, 600 + Math.random() * 900))
  }
}

app.post('/webhook', (req, res) => {
  const { event, sessionId, data } = req.body
  if (!event || !data) {
    return res.status(400).json({ error: 'Invalid webhook payload' })
  }
  if (event !== 'message.received' || data.fromMe) {
    return res.json({ ok: true, skipped: true })
  }

  const messageBody = data.body || data.text
  if (!messageBody) {
    return res.json({ ok: true, skipped: true })
  }

  console.log(`[webhook] message from ${data.from}: ${messageBody.slice(0, 80)}`)

  // Respond 200 immediately so whatbot doesn't retry
  res.json({ ok: true })

  // Fire AI + reply asynchronously (queued to limit concurrency)
  enqueue(() => getReply(messageBody, data.from)).then(async (reply) => {
    addMessage(data.from, 'user', messageBody)
    addMessage(data.from, 'assistant', reply.replace(/\|\|\|/g, ' '))
    console.log(`[webhook] AI reply to ${data.from}: ${reply.slice(0, 80)}`)

    if (WHATSAPP_BASE_URL && WHATSAPP_API_KEY && sessionId) {
      const sendUrl = `${WHATSAPP_BASE_URL.replace(/\/$/, '')}/api/sessions/${sessionId}/messages/send-text`
      const bubbles = splitBubbles(reply)
      try {
        await sendBubbles(sendUrl, WHATSAPP_API_KEY, data.from, bubbles)
        console.log(`[webhook] reply sent to ${data.from} (${bubbles.length} bubble${bubbles.length > 1 ? 's' : ''})`)
      } catch (sendErr) {
        console.error(`[webhook] send failed: ${sendErr.message}`)
      }
    }
  }).catch(async (err) => {
    console.error(`[webhook] AI error: ${err.message}`)
    if (WHATSAPP_BASE_URL && WHATSAPP_API_KEY && sessionId && data) {
      try {
        const sendUrl = `${WHATSAPP_BASE_URL.replace(/\/$/, '')}/api/sessions/${sessionId}/messages/send-text`
        await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATSAPP_API_KEY}` },
          body: JSON.stringify({ chatId: data.from, text: 'Sorry, Will contact you later. 🤍 ' }),
        })
      } catch (_) { /* best-effort fallback */ }
    }
  })
})

app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatbot', developer: 'zaidxme' }))

app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`)
  console.log(`║          whatbot — AI Assistant        ║`)
  console.log(`║       built by zaidxme                 ║`)
  console.log(`╚════════════════════════════════════════╝`)
  console.log(`  Port: ${PORT}`)
  console.log(`  GOOGLE_API_KEY: ${GOOGLE_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  WHATSAPP_BASE_URL: ${WHATSAPP_BASE_URL || 'MISSING'}`)
  console.log(`  WHATSAPP_API_KEY: ${WHATSAPP_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  Coding model: ${CODING_MODEL}`)
  console.log(`  General model: ${GENERAL_MODEL}`)
})