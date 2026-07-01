import express from 'express'
import { EventEmitter } from 'events'

export const bus = new EventEmitter()
const events = []
const MAX_EVENTS = 100

let awayMode = false

export function startServer(port = process.env.DASHBOARD_PORT || 3000) {
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
  if (data.type === 'away') awayMode = data.enabled
}
