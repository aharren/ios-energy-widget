// web server for simulating the widget

// usage: node server.js <filename-of-widget>

'use strict';

const http = require("http");
const fs = require("fs");
const child_process = require('child_process');
const simulate = require('./lib/simulate.js');

if (process.argv.length < 3) {
  console.log('usage: node server.js <filename-of-widget>');
  process.exit(-1);
}
const widget = process.argv[2];

// host and port settings for the web server
const host = 'localhost';
const port = 8000;

// create the web server
const server = http.createServer(async (request, response) => {
  try {
    switch (request.url) {
      default: {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Page not found');
        break;
      }
      case '/': {
        // at /, we serve the start page
        const page = fs.readFileSync(__dirname + '/static/index.html');
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(page);
        break;
      }
      case '/widget': {
        // at /widget, we render the widget and return its image and console output
        const script = fs.readFileSync(widget);
        const output = await simulate(script);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(output, null, 2));
        break;
      }
    }
  } catch (err) {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    console.log(`${(new Date()).toISOString()}: ${err}`);
    response.end('' + err);
  }
});

// start the web server on ${host}:${port} and open the user's browser
server.listen(port, host, () => {
  console.log(`Server is listening at http://${host}:${port}`);

  console.log(`Opening browser ...`);
  child_process.exec(`open "http://${host}:${port}"`);
});
