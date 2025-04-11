require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Create a route to inject environment variables into the client
app.get('/config.js', (req, res) => {
    const config = {
        MAPBOX_API_KEY: process.env.MAPBOX_API_KEY
    };
    res.type('application/javascript');
    res.send(`window.CONFIG = ${JSON.stringify(config)};`);
});

// Modify the index.html to include our config.js
app.get('/', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    // Insert the config.js script before the closing head tag
    html = html.replace('</head>', '<script src="/config.js"></script></head>');
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}); 