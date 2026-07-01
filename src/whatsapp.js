import { isAway, isHost, toggleAway } from './state.js'
import { getReply } from './ai.js'
import { logInteraction } from './sheets.js'

export function setup(client) {
  client.on('message', async (msg) => {
    try {
      const chat = await msg.getChat()
      const sender = msg.author || msg.from

      if (chat.isGroup) return

      if (isHost(sender) && msg.body.trim() === '!away') {
        const now = toggleAway()
        await msg.reply(`Away mode is now ${now ? 'ON' : 'OFF'}`)
        return
      }

      if (isHost(sender)) return
      if (!isAway()) return
      if (msg.body.startsWith('!')) return

      const reply = await getReply(msg.body)

      await msg.reply(reply)

      logInteraction(
        new Date().toISOString(),
        sender,
        msg.body,
        reply
      )
    } catch (err) {
      console.error('Message handler error:', err.message)
      try {
        await msg.reply('Sorry, I ran into an issue processing your message.')
      } catch (_) {}
    }
  })
}
