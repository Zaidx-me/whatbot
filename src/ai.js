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
  const isCoding = isCodingQuery(message)
  const model = isCoding ? CODING_MODEL : GENERAL_MODEL
  const system = isCoding
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
    timeout: 30000,
  })

  return completion.choices[0].message.content.trim()
}
