// render the widget as a png image

// usage: node render-png.js <filename-of-widget> <widget-family> <widget-parameter-string> <scale>

'use strict';

const fs = require("fs");
const cv = require('canvas');
const simulate = require('./lib/simulate.js');

async function main() {
  if (process.argv.length < 6) {
    console.log('usage: node render-png.js <filename-of-widget> <widget-family> <widget-parameter-string> <scale>');
    process.exit(-1);
  }

  const widget = process.argv[2];
  const widgetFamily = process.argv[3];
  const widgetParameter = process.argv[4];
  const scale = parseFloat(process.argv[5]) || 1.0;

  const script = fs.readFileSync(widget);
  const settings = {
    widgetParameter: widgetParameter,
    widgetFamily: widgetFamily,
  }
  const output = await simulate(script, settings);

  const canvas = cv.createCanvas(output.image.width * scale, output.image.height * scale);
  const context = canvas.getContext('2d');

  const image = new cv.Image();
  image.src = 'data:image/png;base64,' + output.image.data;
  context.drawImage(image, 0, 0, output.image.width * scale, output.image.height * scale);
  const buffer = canvas.toBuffer('image/png', { compressionLevel: 0, filters: cv.PNG_FILTER_NONE, resolution: output.image.ppi * scale });
  process.stdout.write(buffer);
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error(err);
  }
})();
