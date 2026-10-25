require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

let inboxFeed = [];
let pairingCode = null;
let pairingRequested = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // OFFICIAL BAILEYS PATTERN: Use the 'qr' event trigger to request pairing code once
    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      const targetPhoneNumber = process.env.PHONE_NUMBER; // E.g. 2348012345678 (digits only, no +)
      
      if (targetPhoneNumber) {
        try {
          pairingCode = await sock.requestPairingCode(targetPhoneNumber.replace(/[^0-9]/g, ''));
          console.log(`=================================`);
          console.log(`YOUR WHATSAPP PAIRING CODE: ${pairingCode}`);
          console.log(`=================================`);
        } catch (err) {
          console.error('Error generating pairing code:', err);
          pairingRequested = false;
        }
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`⚠️ Connection closed (code ${statusCode}). Reconnecting: ${shouldReconnect}`);
      pairingRequested = false;

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
      pairingCode = null;
      pairingRequested = false;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          if (text) {
            const newItem = {
              id: msg.key.id,
              sender: msg.pushName || msg.key.remoteJid,
              platform: 'whatsapp',
              timestamp: new Date().toISOString(),
              snippet: text,
              requiresAction: text.includes('?') || text.toLowerCase().includes('urgent') || text.toLowerCase().includes('meeting')
            };
            inboxFeed.unshift(newItem);
            console.log('📩 New WhatsApp Message:', newItem.snippet);
          }
        }
      }
    }
  });
}

connectToWhatsApp();

app.get('/api/messages', (req, res) => {
  res.json({ success: true, data: inboxFeed });
});

app.get('/api/whatsapp/pairing-code', (req, res) => {
  res.json({ success: true, code: pairingCode });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 InboxPal Server live on port ${PORT}`));
