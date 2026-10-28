require('dotenv').config();
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
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

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      shouldIgnoreJid: (jid) => jid.endsWith('@broadcast')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 Scan this QR code with WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'connecting') {
        waStatus = { state: 'connecting', lastUpdated: new Date().toISOString(), errorDetails: null };
      } else if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        waStatus = { state: 'connected', lastUpdated: new Date().toISOString(), errorDetails: null };
      } else if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        console.log(`⚠️ Connection closed. Status code: ${statusCode}`);

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          console.log('🔴 Logged out by WhatsApp.');
          waStatus = {
            state: 'logged_out',
            lastUpdated: new Date().toISOString(),
            errorDetails: 'Session disconnected by WhatsApp.'
          };
        } else {
          waStatus = { state: 'connecting', lastUpdated: new Date().toISOString(), errorDetails: null };
          setTimeout(connectToWhatsApp, 3000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          try {
            if (!msg.key || msg.key.fromMe || !msg.message) continue;

            const remoteJid = msg.key.remoteJid || '';
            if (remoteJid.endsWith('@broadcast')) continue;

            // Extract message body across different WhatsApp format structures
            const text = 
              msg.message.conversation || 
              msg.message.extendedTextMessage?.text || 
              msg.message.imageMessage?.caption || 
              msg.message.videoMessage?.caption || 
              '';

            if (text) {
              const isGroup = remoteJid.endsWith('@g.us');
              const isChannel = remoteJid.endsWith('@newsletter');
              let senderName = msg.pushName || 'WhatsApp User';
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

              // Avoid duplicate logs if the message ID already exists
              if (!inboxFeed.some(i => i.id === newItem.id)) {
                inboxFeed.unshift(newItem);
                console.log(`📩 New WhatsApp (${chatType}) from ${senderName}: "${newItem.snippet}"`);
              }
            }
          } catch (mErr) {
            console.error('Error parsing single message:', mErr.message);
          }
        }
      }
    });
  } catch (err) {
    waStatus = { state: 'connecting', lastUpdated: new Date().toISOString(), errorDetails: null };
    setTimeout(connectToWhatsApp, 5000);
  }
}

connectToWhatsApp();

app.get('/api/messages', (req, res) => res.json({ success: true, data: inboxFeed }));
app.get('/api/status', (req, res) => res.json({ success: true, status: waStatus }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));
