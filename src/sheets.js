import { google } from 'googleapis'

let sheets
let sheetId

export function init() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  sheets = google.sheets({ version: 'v4', auth })
  sheetId = process.env.GOOGLE_SHEET_ID
}

export async function logInteraction(timestamp, sender, userMessage, aiResponse) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, sender, userMessage, aiResponse]],
      },
    })
  } catch (err) {
    console.warn('Sheets log failed:', err.message)
  }
}
