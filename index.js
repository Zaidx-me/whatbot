import 'dotenv/config'
import { Client, LocalAuth } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import { init as initState } from './src/state.js'
import { init as initAI } from './src/ai.js'
import { init as initSheets } from './src/sheets.js'
import { setup as setupWhatsApp } from './src/whatsapp.js'

if (!process.env.HOST_NUMBER) {
  console.error('FATAL: HOST_NUMBER is not set in .env')
  process.exit(1)
}
initState(process.env.HOST_NUMBER)
initAI()
initSheets()

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
})

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('WhatsApp AI Assistant is ready')
})

client.on('auth_failure', (msg) => console.error('Auth failure:', msg))
client.on('disconnected', (reason) => console.warn('Disconnected:', reason))

setupWhatsApp(client)

client.initialize()

process.on('SIGTERM', () => client.destroy())
process.on('SIGINT', () => client.destroy())
