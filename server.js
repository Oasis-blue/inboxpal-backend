require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

let inboxFeed = [];
let pairingCode = null;

const AUTH_DIR = './auth_info_baileys';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    // Fix 1: Explicitly specify Desktop browser metadata so WhatsApp accepts the pairing code
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Trigger pairing code if not registered yet
    if (qr && !sock.authState.creds.registered && !pairingCode) {
      const targetPhoneNumber = process.env.PHONE_NUMBER;
      if (targetPhoneNumber) {
        try {
          // Add a short 3-second delay to ensure socket is ready
          await new Promise(res => setTimeout(res, 3000));
          pairingCode = await sock.requestPairingCode(targetPhoneNumber);
          console.log(`=================================`);
          console.log(`YOUR WHATSAPP PAIRING CODE: ${pairingCode}`);
          console.log(`=================================`);
        } catch (err) {
          console.error('Error generating pairing code:', err);
        }
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`⚠️ Connection closed (code ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 2000);
      } else {
        console.log('❌ Logged out. Clearing session files...');
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        pairingCode = null;
        setTimeout(connectToWhatsApp, 2000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
      pairingCode = null;
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

// REST APIs
app.get('/api/messages', (req, res) => {
  res.json({ success: true, data: inboxFeed });
});

app.get('/api/whatsapp/pairing-code', (req, res) => {
  res.json({ success: true, code: pairingCode });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 InboxPal Server live on port ${PORT}`));
