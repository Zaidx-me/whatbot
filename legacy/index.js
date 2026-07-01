import 'dotenv/config'
import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
const { Client, LocalAuth } = pkg
import { init as initAI } from './src/ai.js'
import { init as initSheets } from './src/sheets.js'
import { setup as setupWhatsApp } from './src/whatsapp.js'
import { startServer } from './server.js'

initAI()
initSheets()

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: '/usr/bin/chromium',
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
    ],
  },
})

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('WhatsApp AI Assistant is ready')
    startServer()
})

client.on('auth_failure', (msg) => console.error('Auth failure:', msg))
client.on('disconnected', (reason) => console.warn('Disconnected:', reason))

setupWhatsApp(client)

client.initialize()

process.on('SIGTERM', () => client.destroy())
process.on('SIGINT', () => client.destroy())
