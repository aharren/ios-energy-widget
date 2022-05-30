// render the widget as a png image

// usage: node render-raw.js <filename-of-widget> <widget-family> <widget-parameter-string>

'use strict';

const fs = require("fs");
const cv = require('canvas');
const simulate = require('./lib/simulate.js');

async function main() {
  if (process.argv.length < 5) {
    console.log('usage: node render-raw.js <filename-of-widget> <widget-family> <widget-parameter-string>');
    process.exit(-1);
  }

  const widget = process.argv[2];
  const widgetFamily = process.argv[3]; // '_raw.response';
  const widgetParameter = process.argv[4];

  const script = fs.readFileSync(widget);
  const settings = {
    widgetParameter: widgetParameter,
    widgetFamily: widgetFamily,
  }
  const output = await simulate(script, settings);
  process.stdout.write(output.raw);
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
  }
})();
