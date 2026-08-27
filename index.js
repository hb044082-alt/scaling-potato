const http = require("http");
const fs = require("fs");
const path = require("path");
const P = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const PORT = process.env.PORT || 5900;
const AUTH_DIR = path.join(__dirname, "auth_info");

let sock = null;
let pairingInProgress = false;

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WhatsApp Pair Code</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Arial, sans-serif;
      background: #111827;
      color: white;
      padding: 20px;
    }

    .card {
      width: 100%;
      max-width: 420px;
      background: #1f2937;
      padding: 30px;
      border-radius: 18px;
      box-shadow: 0 15px 40px rgba(0,0,0,.35);
    }

    h1 {
      text-align: center;
      margin-top: 0;
    }

    p {
      color: #9ca3af;
      text-align: center;
      line-height: 1.5;
    }

    input {
      width: 100%;
      padding: 15px;
      margin-top: 15px;
      border: 1px solid #374151;
      border-radius: 10px;
      background: #111827;
      color: white;
      font-size: 16px;
      outline: none;
    }

    button {
      width: 100%;
      margin-top: 15px;
      padding: 15px;
      border: 0;
      border-radius: 10px;
      background: #22c55e;
      color: white;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
    }

    button:disabled {
      opacity: .5;
      cursor: not-allowed;
    }

    #result {
      margin-top: 25px;
      text-align: center;
      min-height: 50px;
    }

    .code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 6px;
      background: #111827;
      padding: 18px;
      border-radius: 12px;
      margin-top: 15px;
    }

    .error {
      color: #f87171;
    }

    .success {
      color: #4ade80;
    }
  </style>
</head>
<body>

<div class="card">
  <h1>WhatsApp Pairing</h1>

  <p>
    Enter your WhatsApp number with country code.
    Do not include the + symbol.
  </p>

  <input
    id="phone"
    type="tel"
    placeholder="Example: 12345678900"
    autocomplete="tel"
  >

  <button id="btn" onclick="getPairCode()">
    Generate Pair Code
  </button>

  <div id="result"></div>
</div>

<script>
async function getPairCode() {
  const phoneInput = document.getElementById("phone");
  const button = document.getElementById("btn");
  const result = document.getElementById("result");

  let phone = phoneInput.value.trim();

  phone = phone.replace(/[^0-9]/g, "");

  if (!phone || phone.length < 7) {
    result.innerHTML =
      '<div class="error">Enter a valid WhatsApp number with country code.</div>';
    return;
  }

  button.disabled = true;
  result.innerHTML = "Generating pairing code...";

  try {
    const response = await fetch("/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone: phone
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to generate code");
    }

    result.innerHTML =
      '<div class="success">Enter this code in WhatsApp:</div>' +
      '<div class="code">' + data.code + '</div>';

  } catch (error) {
    result.innerHTML =
      '<div class="error">' + error.message + '</div>';
  }

  button.disabled = false;
}
</script>

</body>
</html>`;

async function startWhatsApp() {
  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: P({
      level: "silent"
    }),
    printQRInTerminal: false,
    browser: [
      "Pairing Bot",
      "Chrome",
      "1.0.0"
    ]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    console.log("WhatsApp connection:", connection);

    if (connection === "open") {
      console.log("WhatsApp connected successfully.");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log("WhatsApp disconnected:", statusCode);

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("Reconnecting...");
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log("WhatsApp session logged out.");
        sock = null;
      }
    }
  });

  return sock;
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
      });

      return res.end(htmlContent);
    }

    if (req.method === "GET" && req.url === "/health") {
      return sendJSON(res, 200, {
        status: "ok",
        whatsapp: !!sock
      });
    }

    if (req.method === "POST" && req.url === "/pair") {
      if (pairingInProgress) {
        return sendJSON(res, 429, {
          error: "Another pairing request is already in progress."
        });
      }

      const body = await readBody(req);

      let phone = String(body.phone || "")
        .replace(/[^0-9]/g, "");

      if (!phone || phone.length < 7) {
        return sendJSON(res, 400, {
          error: "Invalid WhatsApp phone number."
        });
      }

      if (!sock) {
        return sendJSON(res, 503, {
          error: "WhatsApp client is not ready. Try again shortly."
        });
      }

      if (sock.authState?.creds?.registered) {
        return sendJSON(res, 400, {
          error: "This WhatsApp session is already registered."
        });
      }

      pairingInProgress = true;

      try {
        console.log(
          "Requesting pairing code for:",
          phone
        );

        const code =
          await sock.requestPairingCode(phone);

        console.log(
          "Pairing code generated:",
          code
        );

        return sendJSON(res, 200, {
          success: true,
          code: code
        });

      } finally {
        pairingInProgress = false;
      }
    }

    res.writeHead(404, {
      "Content-Type": "text/plain"
    });

    res.end("Not Found");

  } catch (error) {
    console.error(error);

    sendJSON(res, 500, {
      error: error.message || "Internal server error"
    });
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`HTTP server listening on port ${PORT}`);

  try {
    await startWhatsApp();
    console.log("WhatsApp client initialized.");
  } catch (error) {
    console.error(
      "Failed to initialize WhatsApp:",
      error
    );
  }
});
