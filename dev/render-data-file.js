// render a data file for the widget

// usage: node render-data-file.js <filename-of-widget> [<widget-parameter-string>]

'use strict';

const fs = require("fs");
const simulate = require('./lib/simulate.js');

async function main() {
  if (process.argv.length < 3) {
    console.log('usage: node render-data-file.js <filename-of-widget> [<widget-parameter-string>]');
    process.exit(-1);
  }

  const widget = process.argv[2];
  const widgetFamily = '_raw.response';
  const widgetParameter = process.argv[3] || 'server=grafana';

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
