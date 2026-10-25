require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

let inboxFeed = [];
let waStatus = {
  state: 'connecting',
  lastUpdated: new Date().toISOString(),
  errorDetails: null
};

let sock = null;

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        waStatus = { state: 'connecting', lastUpdated: new Date().toISOString(), errorDetails: null };
      } else if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        waStatus = { state: 'connected', lastUpdated: new Date().toISOString(), errorDetails: null };
      } else if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        
        console.log(`❌ Connection closed. Status code: ${statusCode || 'Unknown'}`);

        if (isLoggedOut) {
          waStatus = {
            state: 'logged_out',
            lastUpdated: new Date().toISOString(),
            errorDetails: 'WhatsApp session logged out. Re-pairing or QR scan required.'
          };
        } else {
          waStatus = {
            state: 'error',
            lastUpdated: new Date().toISOString(),
            errorDetails: `Connection timed out or closed (Code: ${statusCode || 408}). Retrying...`
          };
          setTimeout(connectToWhatsApp, 5000);
        }
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
              
              if (isGroup) chatType = 'group';
              else if (isChannel) chatType = 'channel';

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
  } catch (err) {
    console.error('Initialization Error:', err);
    waStatus = {
      state: 'error',
      lastUpdated: new Date().toISOString(),
      errorDetails: 'Connection init error. Retrying in 5s...'
    };
    setTimeout(connectToWhatsApp, 5000);
  }
}

connectToWhatsApp();

app.get('/api/messages', (req, res) => res.json({ success: true, data: inboxFeed }));
app.get('/api/status', (req, res) => res.json({ success: true, status: waStatus }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 InboxPal Server live on port ${PORT}`));
