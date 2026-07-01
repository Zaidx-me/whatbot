import OpenAI from 'openai'
import express from 'express'
import { addMessage, formatHistory } from './memory.js'
import profiles from './profiles.json' with { type: 'json' }

const CODING_MODEL = 'mistralai/codestral-22b-instruct-v0.1'
const GENERAL_MODEL = 'meta/llama-3.1-8b-instruct'
const CODING_KEYWORDS = ['```', 'function', 'class ', 'def ', 'import ', 'const ', 'let ', 'var ', '=>', 'console.log', '#include', 'npm ', 'git ', 'code', 'bug', 'error', 'debug', 'compile', 'syntax', 'algorithm', 'api']

function isCodingQuery(text) {
  const lower = text.toLowerCase()
  return CODING_KEYWORDS.some(kw => lower.includes(kw))
}

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
const WHATSAPP_BASE_URL = process.env.WHATSAPP_BASE_URL
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY
const PORT = parseInt(process.env.PORT || '3000', 10)

const openai = new OpenAI({ baseURL: NVIDIA_BASE_URL, apiKey: NVIDIA_API_KEY, timeout: 120000, maxRetries: 0 })

const app = express()
app.use(express.json())

async function getReply(message, phone) {
  const profile = profiles[phone]
  const isCoding = isCodingQuery(message)
  const model = isCoding ? CODING_MODEL : GENERAL_MODEL

  const systemMessages = []
  if (profile) {
    const history = formatHistory(phone)
    const systemParts = [
      `You are whatbot — an AI personal assistant for ${profile.name}, built by zaidxme.`,
      profile.instructions,
      ``,
      `USER PROFILE:`,
      JSON.stringify(profile.persona, null, 2),
    ]
    if (history) {
      systemParts.push('', `RECENT CONVERSATION:`, history)
    }
    systemMessages.push({ role: 'system', content: systemParts.join('\n') })
  } else {
    const system = isCoding
      ? 'You are a helpful coding assistant. Provide concise, correct answers.'
      : 'You are a helpful assistant. Be friendly and concise.'
    systemMessages.push({ role: 'system', content: system })
  }

  systemMessages.push({ role: 'user', content: message })

  console.log(`[webhook] getReply model=${model} phone=${phone} profile=${!!profile}`)

  const completion = await openai.chat.completions.create({
    model,
    messages: systemMessages,
    max_tokens: isCoding ? 2048 : 512,
    temperature: 0.7,
  })
  const content = completion.choices[0]?.message?.content
  if (!content) return 'Sorry, I got an empty response from the AI.'
  return content.trim()
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

  // Fire AI + reply asynchronously
  getReply(messageBody, data.from).then(async (reply) => {
    addMessage(data.from, 'user', messageBody)
    addMessage(data.from, 'assistant', reply)
    console.log(`[webhook] AI reply to ${data.from}: ${reply.slice(0, 80)}`)

    if (WHATSAPP_BASE_URL && WHATSAPP_API_KEY && sessionId) {
      try {
        const sendUrl = `${WHATSAPP_BASE_URL.replace(/\/$/, '')}/api/sessions/${sessionId}/messages/send-text`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        const resp = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${WHATSAPP_API_KEY}` },
          body: JSON.stringify({ chatId: data.from, text: reply }),
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          console.error(`[webhook] whatbot API error ${resp.status}: ${errText}`)
        } else {
          console.log(`[webhook] reply sent to ${data.from}`)
        }
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
          body: JSON.stringify({ chatId: data.from, text: 'Sorry, I had trouble processing that. Try asking again.' }),
        })
      } catch (_) { /* best-effort fallback */ }
    }
  })
})

app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatbot', developer: 'zaidxme' }))

app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`)
  console.log(`║          whatbot — AI Assistant         ║`)
  console.log(`║       built by zaidxme                  ║`)
  console.log(`╚════════════════════════════════════════╝`)
  console.log(`  Port: ${PORT}`)
  console.log(`  NVIDIA_API_KEY: ${NVIDIA_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  WHATSAPP_BASE_URL: ${WHATSAPP_BASE_URL || 'MISSING'}`)
  console.log(`  WHATSAPP_API_KEY: ${WHATSAPP_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  Coding model: ${CODING_MODEL}`)
  console.log(`  General model: ${GENERAL_MODEL}`)
})
