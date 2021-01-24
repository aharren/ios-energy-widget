'use strict';

//
// configuration
//

const C = {
  widget: {
    preview: {
      parameters: {
        style: 1,
      },
      widget: {
        family: 'medium',
      },
    },
    background: {
      gradient: [
        { location: 0, color: new Color('#181818') },
        { location: 1, color: new Color('#080808') },
      ],
    },
  },
  data: {
    server: {
      url: 'https://grafana.local:3000',
      apikey: 'APIKEY',
    },
    database: 'measurements',
    series: {
      photovoltaics: {
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "photovoltaics-energy-counter-consumption" WHERE ${time-range} GROUP BY ${time-interval} fill(0)', // kWh
          color: Color.yellow(),
        },
      },
      battery: {
        charge: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-charge" WHERE ${time-range} GROUP BY ${time-interval} fill(0)', // kWh
          color: new Color('#00aaee'),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-discharge" WHERE ${time-range} GROUP BY ${time-interval} fill(0)', // kWh
          color: Color.orange(),
        },
        level: {
          query: 'SELECT last("value") FROM "battery-charge-level" WHERE ${time-range} GROUP BY ${time-interval} fill(previous)', // percentage
          color: Color.orange(),
        }
      },
      grid: {
        feed: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-out" WHERE ${time-range} GROUP BY ${time-interval} fill(0)', // kWh
          color: Color.green(),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-in" WHERE ${time-range} GROUP BY ${time-interval} fill(0)', // kWh
          color: Color.red(),
        },
      },
    },
    max: {
      consumption: 15, // kWh
      feed: 25, // kWh
      sumPerSegment: 1, // kWh
    }
  },
};

//
// runtime
//

const R = {
  // widget parameters --- format is key1=value1;key2=value2;...
  parameters: (() => {
    const p = (args.widgetParameter || '').toLowerCase().split(';').reduce((obj, element) => { const keyvalue = element.split('='); obj[keyvalue[0]] = keyvalue[1]; return obj; }, {});
    return {
      // style=<number> --- visual style of the widget
      style: parseInt(p.style) || C.widget.preview.parameters.style,
    }
  })(),
  widget: {
    family: config.widgetFamily || C.widget.preview.widget.family,
  },
  time: (() => {
    const t = new Date();
    const now = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), Math.floor(t.getMinutes() / 15) * 15, 0);
    return {
      timestampNow: now.getTime(),
      timestampNowMinus24h: now.getTime() - 1000 * 60 * 60 * 24,
      timestampToday0h: (new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)).getTime(),
      delta15min: 1000 * 60 * 15,
    }
  })(),
}

//
// query handling
//

async function getSeriesValues(series) {

  async function executeQueries(queries) {
    function escapeURLSegment(segment) {
      return segment.replace(/[^0-9A-Za-z]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
    }

    const q = queries.join(';')
      .replace(/\$\{time\-range\}/gi, ` (time >= ${R.time.timestampNowMinus24h - R.time.delta15min * 2}ms AND time <= ${R.time.timestampNow}ms) `)
      .replace(/\$\{time\-interval\}/gi, ` time(15m) `)
      ;
    const url = `${C.data.server.url}/api/datasources/proxy/1/query?db=${escapeURLSegment(C.data.database)}&epoch=ms&q=${escapeURLSegment(q)}`;

    const request = new Request(url);
    request.headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${C.data.server.apikey}`,
    }
    const response = await request.loadJSON();
    if (!response.results) {
      console.error('request failed: ' + JSON.stringify(response, null, 2));
    }
    return response.results;
  }

  function createSeriesQueries(series) {
    const queries = [];
    for (const k in series) {
      if (series.hasOwnProperty(k)) {
        for (const sk in series[k]) {
          if (series[k].hasOwnProperty(sk)) {
            if (series[k][sk].query) {
              queries.push(series[k][sk].query);
            }
          }
        }
      }
    }
    return queries;
  }

  function transformResults(series, results) {
    function transformResultArray(results) {
      const timestampStart = R.time.timestampNowMinus24h;
      const timestampEnd = R.time.timestampNow;
      const r = results.reduce((obj, element) => { obj[element[0]] = element[1]; return obj; }, {});
      const a = {
        all: new Array(96).fill(0),
        today: new Array(96).fill(0),
        yesterday: new Array(96).fill(0),
      };
      for (let i = 0, timestamp = R.time.timestampNowMinus24h; i < 96; i++, timestamp += R.time.delta15min) {
        const value = r[timestamp] > 0 ? r[timestamp] : 0;
        if (timestamp >= timestampStart) {
          a.all[i] = value;
          if (timestamp < R.time.timestampToday0h) {
            a.yesterday[i] = value;
          } else if (timestamp < timestampEnd) {
            a.today[i] = value;
          }
        }
      }
      return a;
    }

    const values = {};
    let i = 0;
    for (const k in series) {
      if (series.hasOwnProperty(k)) {
        values[k] = {};
        for (const sk in series[k]) {
          if (series[k].hasOwnProperty(sk)) {
            const ra = series[k][sk].query ? results[i++].series[0].values : [];
            const r = transformResultArray(ra);
            values[k][sk] = {
              values: r,
              color: series[k][sk].color,
              valuesLast: r.all[r.all.length - 1],
              valuesSum: r.all.reduce((sum, element) => { return sum + element }, 0.0),
            };
          }
        }
      }
    }
    return values;
  }

  const queries = createSeriesQueries(series);
  const results = await executeQueries(queries);
  const values = transformResults(series, results);
  return values;
}

//
// drawing functions
//

function drawMultiSegmentDonut(dc, circle, segments, text) {
  function drawDonutSegment(dc, centerX, centerY, radius, lineWidth, maxValue, startValue, endValue, color) {
    dc.setStrokeColor(color);
    dc.setFillColor(color);
    dc.setLineWidth(lineWidth);
    if (startValue === 0 && endValue === maxValue) {
      dc.strokeEllipse(new Rect(centerX - radius, centerY - radius, 2 * radius, 2 * radius));
    } else {
      const f = 4.0;
      const start = (startValue / maxValue) * 100.0;
      const end = (endValue / maxValue) * 100.0;
      for (let i = Math.max(0.0, start) * f; i <= Math.min(100.0, end) * f; i++) {
        const x = centerX + Math.sin(i / (f * 50.0) * Math.PI) * radius;
        const y = centerY - Math.cos(i / (f * 50.0) * Math.PI) * radius;
        dc.fillEllipse(new Rect(x - lineWidth / 2, y - lineWidth / 2, lineWidth, lineWidth));
      }
    }
  }

  if (circle.color) {
    drawDonutSegment(dc, circle.x, circle.y, circle.radius, circle.lineWidth, circle.maxValue, 0, circle.maxValue, circle.color);
  }

  for (let i = 0, baseValue = 0; i < segments.length; i++) {
    const value = segments[i].value;
    const color = segments[i].color;
    drawDonutSegment(dc, circle.x, circle.y, circle.radius, circle.lineWidth, circle.maxValue, baseValue, baseValue + value, color);
    baseValue += value;
  }
  for (let i = 0, baseValue = 0; i < segments.length - 1; i++) {
    const value = segments[i].value;
    const color = segments[i].color;
    drawDonutSegment(dc, circle.x, circle.y, circle.radius, circle.lineWidth, circle.maxValue, baseValue + value, baseValue + value, color);
    baseValue += value;
  }

  if (text) {
    dc.setTextAlignedCenter();
    dc.setFont(Font.systemFont(text.fontSize));
    dc.setTextColor(text.color);
    const height = text.fontSize * 1.2;
    dc.drawTextInRect('' + text.text, new Rect(circle.x - circle.radius, circle.y - height / 2, 2 * circle.radius, height));
  }
}

function imageWithMultiSegmentDonut(size, circle, segments, text) {
  const dc = new DrawContext();
  dc.size = new Size(size.width, size.height);
  dc.opaque = false;
  dc.respectScreenScale = true

  drawMultiSegmentDonut(dc, circle, segments, text);
  return dc.getImage();
}

function drawMultiSegmentChart(dc, rect, segments, maxSum, index0) {
  const w = rect.width / segments[0].values.length;
  const lr = w / 4;
  for (let i = 0, x = rect.x; i < segments[0].values.length; i++) {
    const ri = (i + index0) % segments[0].values.length;
    let baseValue = rect.height;
    for (let j = segments.length - 1; j >= 0; j--) {
      const value = (segments[j].values[ri] / maxSum) * rect.height;
      dc.setFillColor(segments[j].color);
      baseValue -= value;
      dc.fillRect(new Rect(x + lr, rect.y + baseValue, w - lr, value));
    }
    x += w;
  }
}

function imageWithMultiSegmentChart(size, rect, segments, maxSum, index0) {
  const dc = new DrawContext();
  dc.size = new Size(size.width, size.height);
  dc.opaque = false;
  dc.respectScreenScale = true

  drawMultiSegmentChart(dc, rect, segments, maxSum, index0);
  return dc.getImage();
}

//
// get the data
//

const V = {
  data: {
    series: await getSeriesValues(C.data.series),
  }
};

//
// render the data
//

// consumption mix --- photovoltaics consumption, battery consumption, grid consumption
function imageForConsumptionMix(size) {
  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.consume.valuesSum, color: V.data.series.battery.consume.color },
    { value: V.data.series.grid.consume.valuesSum, color: V.data.series.grid.consume.color }
  ];

  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  const maxValue = C.data.max.consumption;

  return imageWithMultiSegmentDonut(
    size,
    { x: size.width / 2, y: size.height / 2, radius: (size.width - 6.5) / 2, lineWidth: 6.5, maxValue: maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 17, color: Color.white() }
  );
};

// grid feed
function imageForGridFeed(size) {
  const sum = V.data.series.grid.feed.valuesSum;
  const segments = [
    { value: sum, color: V.data.series.grid.feed.color },
  ];
  const maxValue = C.data.max.feed;

  return imageWithMultiSegmentDonut(
    size,
    { x: size.width / 2, y: size.height / 2, radius: (size.width - 6.5) / 2, lineWidth: 6.5, maxValue: maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 17, color: V.data.series.grid.feed.color }
  );
}

// production mix --- photovoltaics consumption, battery charge, grid feed
function imageForProductionMix(size) {
  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.charge.valuesSum, color: V.data.series.battery.charge.color },
    { value: V.data.series.grid.feed.valuesSum, color: V.data.series.grid.feed.color },
  ];
  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  const maxValue = sum;

  return imageWithMultiSegmentDonut(
    size,
    { x: size.width / 2, y: size.height / 2, radius: (size.width - 6.5) / 2, lineWidth: 6.5, maxValue: maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 17, color: Color.white() }
  );
}

// battery charge level
function imageForBatteryChargeLevel(size) {
  const level = V.data.series.battery.level.valuesLast;
  const segments = [
    { value: level, color: V.data.series.battery.level.color },
  ];

  return imageWithMultiSegmentDonut(
    size,
    { x: size.width / 2, y: size.height / 2, radius: (size.width - 6.5) / 2, lineWidth: 6.5, maxValue: 100.0, color: new Color('444444', 0.5) },
    segments,
    { text: level.toFixed(0) + '%', fontSize: 17, color: V.data.series.battery.level.color }
  );
}

// timeline --- consumption, grid feed, battery charge
function imageForProductionConsumptionMixTimeline(size) {
  return imageWithMultiSegmentChart(
    size,
    { x: 0, y: 0, width: size.width, height: size.height },
    [
      // today
      { values: V.data.series.grid.feed.values.today, color: V.data.series.grid.feed.color },
      { values: V.data.series.battery.charge.values.today, color: V.data.series.battery.charge.color },
      { values: V.data.series.grid.consume.values.today, color: V.data.series.grid.consume.color },
      { values: V.data.series.battery.consume.values.today, color: V.data.series.battery.consume.color },
      { values: V.data.series.photovoltaics.consume.values.today, color: V.data.series.photovoltaics.consume.color },
      // yesterday
      { values: V.data.series.grid.feed.values.yesterday, color: new Color(V.data.series.grid.feed.color.hex, 0.5) },
      { values: V.data.series.battery.charge.values.yesterday, color: new Color(V.data.series.battery.charge.color.hex, 0.5) },
      { values: V.data.series.grid.consume.values.yesterday, color: new Color(V.data.series.grid.consume.color.hex, 0.5) },
      { values: V.data.series.battery.consume.values.yesterday, color: new Color(V.data.series.battery.consume.color.hex, 0.5) },
      { values: V.data.series.photovoltaics.consume.values.yesterday, color: new Color(V.data.series.photovoltaics.consume.color.hex, 0.5) },
    ],
    C.data.max.sumPerSegment,
    // let the timeline start at 0:00 today
    (R.time.timestampToday0h - R.time.timestampNowMinus24h) / R.time.delta15min
  );
}

//
// build the widget
//

const widget = new ListWidget();

const gradient = new LinearGradient()
gradient.colors = C.widget.background.gradient.map((element) => element.color);
gradient.locations = C.widget.background.gradient.map((element) => element.location);
widget.backgroundGradient = gradient;

function addWidgetRow(widget, width, images) {
  const stack = widget.addStack();
  stack.layoutHorizontally();
  images = images.filter((element) => element !== null);
  const space = Math.max(0, width - images.reduce((sum, image) => sum + image.size.width, 0));
  const count = images.length - (1 - images.length % 2);
  const spacing = {
    first: (images.length % 2 ? space / count / 2 : 0),
    default: space / count,
  };
  for (let i = 0; i < images.length; i++) {
    stack.addSpacer(i === 0 ? spacing.first : spacing.default);
    stack.addImage(images[i]);
  }
}

switch (R.widget.family) {
  default:
  case 'small':
    {
      const width = (168 - 17 * 2);
      const imageDonutSize = { width: (width - 14) / 2, height: (width - 14) / 2 };
      switch (R.parameters.style) {
        default:
          addWidgetRow(widget, width,
            [
              imageForConsumptionMix(imageDonutSize),
              imageForGridFeed(imageDonutSize),
            ]
          );
          widget.addSpacer(14);
          addWidgetRow(widget, width,
            [
              imageForProductionMix(imageDonutSize),
              imageForBatteryChargeLevel(imageDonutSize),
            ]
          );
          break;
      }
    }
    break;
  case 'medium':
    {
      const width = (358 - 17 * 2);
      const height = (168 - 17 * 2);
      const imageDonutSize = { width: height / 2, height: height / 2 };
      switch (R.parameters.style) {
        default:
        case 1:
          // widget parameter: style=1
          addWidgetRow(widget, width,
            [
              imageForConsumptionMix(imageDonutSize),
              imageForGridFeed(imageDonutSize),
              imageForProductionMix(imageDonutSize),
              imageForBatteryChargeLevel(imageDonutSize),
            ]
          );
          addWidgetRow(widget, width,
            [
              imageForProductionConsumptionMixTimeline({ width: width, height: height / 2 }),
            ]
          );
          break;
        case 2:
          // widget parameter: style=2
          addWidgetRow(widget, width,
            [
              imageForConsumptionMix(imageDonutSize),
              imageForGridFeed(imageDonutSize),
              imageForProductionMix(imageDonutSize),
              imageForBatteryChargeLevel(imageDonutSize),
            ]
          );
          break;
        case 3:
          // widget parameter: style=3
          addWidgetRow(widget, width,
            [
              imageForProductionConsumptionMixTimeline({ width: width, height: height }),
            ]
          );
          break;
      }
    }
    break;
}

if (!config.runsInWidget) {
  switch (R.widget.family) {
    default:
    case 'small':
      await widget.presentSmall();
      break;
    case 'medium':
      await widget.presentMedium();
      break;
  }
}

Script.setWidget(widget);
Script.complete();
