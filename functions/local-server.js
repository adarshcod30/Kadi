// local-server.js — run the KADI API locally (mock backend) for development + demo.
// `node local-server.js`  (reads DATA_DIR / API_PORT from env; see .env.example)
const { buildApp } = require('./api/app');

const PORT = process.env.API_PORT || 9000;
const app = buildApp();

// Warm the store once at startup (loads CSVs + derived JSON into memory).
require('./api/services/store.mock').load();

app.listen(PORT, () => {
  console.log(`[kadi-api] listening on http://localhost:${PORT}`);
  console.log('[kadi-api] set request header  x-kadi-role: SI|Inspector|ACP|Analyst|Admin  to switch role');
});
