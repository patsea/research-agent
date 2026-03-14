require('dotenv').config();
const express = require('express');
const path = require('path');

// Signal Scanner — UI server only.
// The daily pipeline runs independently via: node pipeline/run.js
// Start this server when you want to review signals: node server.js
// Stop it (Ctrl+C) when done — it does not need to run continuously.

const app = express();
const PORT = process.env.PORT || 3033;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/signals', require('./routes/signals'));
app.use('/api/sources', require('./routes/sources'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Signal Scanner UI running at http://localhost:${PORT}`);
  console.log(`  Daily pipeline runs independently — check launchd or run manually:`);
  console.log(`  node pipeline/run.js\n`);
});
