const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const { exec } = require("child_process");
const qrcode = require("qrcode-terminal");

// ===== STORAGE =====
const msgStore = {};

// ===== MP3 → OPUS =====
function convertToPTT(input, output) {
  return new Promise((resolve, reject) => {
    exec(`ffmpeg -i "${input}" -vn -c:a libopus -b:a 96k "${output}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ===== BOT START =====
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    auth: state,
  });

  // ===== QR / PAIR =====
  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log("📱 Scan QR:");
      qrcode.generate(qr, { small: true });
    }

    // Pair code option
    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode("91XXXXXXXXXX"); // apna number daalo
      console.log("🔑 Pair Code:", code);
    }

    if (connection === "open") {
      console.log("✅ Bot Connected");
    }

    if (connection === "close") {
      console.log("🔄 Reconnecting...");
      startBot();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ===== MESSAGE HANDLER =====
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const jid = msg.key.remoteJid;
    const id = msg.key.id;

    // ===== STORE MESSAGE =====
    msgStore[id] = msg.message;

    // ===== DELETE LOGGER =====
    if (msg.message?.protocolMessage?.type === 0) {
      const deletedId = msg.message.protocolMessage.key.id;
      const original = msgStore[deletedId];

      if (original?.conversation) {
        await sock.sendMessage(jid, {
          text: `⚠️ Deleted Message:\n${original.conversation}`
        });
      }
    }

    // ===== TEXT =====
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text;

    // ===== COMMANDS =====
    if (text === "hi") {
      await sock.sendMessage(jid, {
        text: "👋 Hello! Bot is active."
      });
    }

    if (text === ".menu") {
      await sock.sendMessage(jid, {
        text: `📜 MENU:
1. hi
2. send audio → convert to voice note
3. deleted msg logger active`
      });
    }

    // ===== AUDIO → PTT =====
    if (msg.message.audioMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer");

        fs.writeFileSync("input.mp3", buffer);
        await convertToPTT("input.mp3", "output.opus");

        await sock.sendMessage(jid, {
          audio: fs.readFileSync("output.opus"),
          mimetype: "audio/ogg; codecs=opus",
          ptt: true
        });

        console.log("🎤 Converted to Voice Note");
      } catch (err) {
        console.log("❌ Error:", err);
      }
    }
  });
}

startBot();
