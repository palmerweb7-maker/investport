const fs = require('fs');
const path = require('path');

const apiUrl = process.env.INVESTMENT_API_URL || '';
const target = path.join(__dirname, '..', 'public', 'runtime-config.js');

const body = apiUrl
  ? `window.INVESTMENT_API_URL = ${JSON.stringify(apiUrl.replace(/\/$/, ''))};\n`
  : '// Optional production override. Netlify can also proxy /api through netlify.toml.\n';

fs.writeFileSync(target, body);
console.log(`Wrote runtime config${apiUrl ? ` for ${apiUrl}` : ' with /api fallback'}.`);
