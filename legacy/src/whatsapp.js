import { isAway, toggleAway } from './state.js'
import { getReply } from './ai.js'
import { logInteraction } from './sheets.js'
import { pushEvent } from '../server.js'

export function setup(client) {
  client.on('message', async (msg) => {
    const sender = msg.author || msg.from
    try {
      const chat = await msg.getChat()

      if (chat.isGroup) return

      if (msg.body.trim() === '!away') {
        const now = toggleAway()
        pushEvent({ type: 'away', enabled: now })
        await msg.reply(`Away mode is now ${now ? 'ON' : 'OFF'}`)
        return
      }

      if (msg.body.startsWith('!')) return
      if (!isAway()) return

      console.log('AI request from', sender, ':', msg.body)
      const reply = await getReply(msg.body)
      console.log('AI response:', reply)

      await msg.reply(reply)

      pushEvent({ type: 'message', timestamp: new Date().toISOString(), sender, message: msg.body, response: reply })
      logInteraction(
        new Date().toISOString(),
        sender,
        msg.body,
        reply
      )
    } catch (err) {
      console.error('Message handler error:', err.message)
      pushEvent({ type: 'error', timestamp: new Date().toISOString(), sender, message: msg.body, error: err.message })
      try {
        await msg.reply('Sorry, I ran into an issue processing your message.')
      } catch (_) {}
    }
  })
}
