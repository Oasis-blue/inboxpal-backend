require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

let inboxFeed = [];

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          const remoteJid = msg.key.remoteJid || '';
          
          const isGroup = remoteJid.endsWith('@g.us');
          const isChannel = remoteJid.endsWith('@newsletter');
          
          if (text) {
            let senderName = msg.pushName || 'Unknown';
            let chatType = 'dm';
            
            if (isGroup) {
              chatType = 'group';
            } else if (isChannel) {
              chatType = 'channel';
            }

            // Convert WhatsApp message timestamp (seconds) to ISO string
            const msgTimestamp = msg.messageTimestamp 
              ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() 
              : new Date().toISOString();

            const newItem = {
              id: msg.key.id,
              sender: senderName,
              chatType: chatType,
              platform: 'whatsapp',
              timestamp: msgTimestamp,
              snippet: text,
              requiresAction: text.includes('?') || text.toLowerCase().includes('urgent')
            };
            
            inboxFeed.unshift(newItem);
            console.log(`📩 New WhatsApp (${chatType}):`, newItem.snippet);
          }
        }
      }
    }
  });
}

connectToWhatsApp();

app.get('/api/messages', (req, res) => res.json({ success: true, data: inboxFeed }));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 InboxPal Server live on port ${PORT}`));
