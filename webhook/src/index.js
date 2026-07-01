import OpenAI from 'openai'
import express from 'express'

const CODING_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct'
const GENERAL_MODEL = 'openai/gpt-oss-120b'
const CODING_KEYWORDS = ['```', 'function', 'class ', 'def ', 'import ', 'const ', 'let ', 'var ', '=>', 'console.log', '#include', 'npm ', 'git ', 'code', 'bug', 'error', 'debug', 'compile', 'syntax', 'algorithm', 'api']

function isCodingQuery(text) {
  const lower = text.toLowerCase()
  return CODING_KEYWORDS.some(kw => lower.includes(kw))
}

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY
const OPENWA_BASE_URL = process.env.OPENWA_BASE_URL
const OPENWA_API_KEY = process.env.OPENWA_API_KEY
const PORT = parseInt(process.env.PORT || '3000', 10)

const openai = new OpenAI({ baseURL: NVIDIA_BASE_URL, apiKey: NVIDIA_API_KEY, timeout: 60000, maxRetries: 0 })

const app = express()
app.use(express.json())

async function getReply(message) {
  const isCoding = isCodingQuery(message)
  const model = isCoding ? CODING_MODEL : GENERAL_MODEL
  console.log(`[webhook] getReply model=${model} message=${message.slice(0, 50)}`)
  const system = isCoding
    ? 'You are a helpful coding assistant. Provide concise, correct answers.'
    : 'You are a helpful assistant. Be friendly and concise.'

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    max_tokens: 1024,
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

  // Respond 200 immediately so OpenWA doesn't retry
  res.json({ ok: true })

  // Fire AI + reply asynchronously
  getReply(messageBody).then(async (reply) => {
    console.log(`[webhook] AI reply to ${data.from}: ${reply.slice(0, 80)}`)

    if (OPENWA_BASE_URL && OPENWA_API_KEY && sessionId) {
      const sendUrl = `${OPENWA_BASE_URL.replace(/\/$/, '')}/api/sessions/${sessionId}/messages/send-text`
      const resp = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENWA_API_KEY}`,
        },
        body: JSON.stringify({ chatId: data.from, text: reply }),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        console.error(`[webhook] OpenWA API error ${resp.status}: ${errText}`)
      } else {
        console.log(`[webhook] reply sent to ${data.from}`)
      }
    }
  }).catch(async (err) => {
    console.error(`[webhook] AI error: ${err.message}`)
    if (OPENWA_BASE_URL && OPENWA_API_KEY && sessionId && data) {
      try {
        const sendUrl = `${OPENWA_BASE_URL.replace(/\/$/, '')}/api/sessions/${sessionId}/messages/send-text`
        await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENWA_API_KEY}` },
          body: JSON.stringify({ chatId: data.from, text: 'Sorry, I had trouble processing that. Try asking again.' }),
        })
      } catch (_) { /* best-effort fallback */ }
    }
  })
})

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`AI webhook handler listening on port ${PORT}`)
  console.log(`  NVIDIA_API_KEY: ${NVIDIA_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  OPENWA_BASE_URL: ${OPENWA_BASE_URL || 'MISSING'}`)
  console.log(`  OPENWA_API_KEY: ${OPENWA_API_KEY ? 'set' : 'MISSING'}`)
  console.log(`  Coding model: ${CODING_MODEL}`)
  console.log(`  General model: ${GENERAL_MODEL}`)
})
