'use strict';

//
// static configuration
//

const C = {
  widget: {
    // configuration for the in-app preview
    preview: {
      parameters: {
        style: 1,
        timeRange: 'last-24h',
      },
      widget: {
        family: 'medium',
      },
    },
    // settings for the widget background and gradient colors
    background: {
      gradient: [
        { location: 0, color: new Color('#181818') },
        { location: 1, color: new Color('#080808') },
      ],
    },
  },
  data: {
    // connection details for the Grafana server; protocol, host, port, API key
    server: {
      url: 'https://grafana.local:3000',
      apikey: 'APIKEY',
    },
    // id of the Grafana data source; check https://grafana.local:3000/api/datasources
    dataSourceId: 1,
    // name of the backend database
    database: 'measurements',
    // device-measurement time series
    series: {
      photovoltaics: {
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "photovoltaics-energy-counter-consumption" WHERE ${time-range} GROUP BY ${time-interval} fill(null)', // kWh
          color: Color.yellow(),
        },
      },
      battery: {
        charge: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-charge" WHERE ${time-range} GROUP BY ${time-interval} fill(null)', // kWh
          color: Color.blue(),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-discharge" WHERE ${time-range} GROUP BY ${time-interval} fill(null)', // kWh
          color: Color.orange(),
        },
        level: {
          query: 'SELECT last("value") FROM "battery-charge-level" WHERE ${time-range} GROUP BY ${time-interval} fill(previous)', // percentage
          color: Color.orange(),
        }
      },
      grid: {
        feed: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-out" WHERE ${time-range} GROUP BY ${time-interval} fill(null)', // kWh
          color: Color.green(),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-in" WHERE ${time-range} GROUP BY ${time-interval} fill(null)', // kWh
          color: Color.red(),
        },
      },
    },
    // max values to use when rendering the graphics
    max: {
      consumption: 15, // kWh
      production: 30, // kWh
      feed: 25, // kWh
      sumPerSegment: 1, // kWh
    },
    // colors
    colors: {
      consumption: Color.white(),
      production: Color.yellow(),
      productionYesterday: new Color('#aaaaaa', 0.5),
    },
  },
};

//
// runtime configuration
//

const R = {
  // widget parameters --- format is key1=value1;key2=value2;...
  parameters: (() => {
    const p = (args.widgetParameter || '').toLowerCase().split(';').reduce((obj, element) => { const keyvalue = element.split('='); obj[keyvalue[0]] = keyvalue[1]; return obj; }, {});
    return {
      // style=<number> --- visual style of the widget
      style: parseInt(p.style) || C.widget.preview.parameters.style,
      // time-range=last-24h or today --- time range to display
      timeRange: p['time-range'] || C.widget.preview.parameters.timeRange,
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

// retrieve the values for the given device-measurement time series configuration
async function getSeriesValues(series) {

  // send a query request to the server and return the query results as an array of objects with timestamps as keys
  async function executeQueries(queries) {
    // queries = [
    //   'query 1',
    //   'query 2',
    //   ...
    // ]

    function escapeURLSegment(segment) {
      return segment.replace(/[^0-9A-Za-z]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
    }

    // join the queries into a single ;-separated string and replace the time placeholders
    const q = queries.join(';')
      .replace(/\$\{time\-range\}/gi, ` (time >= ${R.time.timestampNowMinus24h - R.time.delta15min * 2}ms AND time <= ${R.time.timestampNow}ms) `)
      .replace(/\$\{time\-interval\}/gi, ` time(15m) `)
      ;
    const url = `${C.data.server.url}/api/datasources/proxy/${C.data.dataSourceId}/query?db=${escapeURLSegment(C.data.database)}&epoch=ms&q=${escapeURLSegment(q)}`;

    // send the request with the queries to the server
    const request = new Request(url);
    request.headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${C.data.server.apikey}`,
    }

    // retrieve the response
    const response = await request.loadJSON();
    if (!response.results) {
      console.error('request failed: ' + JSON.stringify(response, null, 2));
      response.results = queries.map(() => { return {} });
    }

    // transform the response into an array of objects with timestamp-to-value properties
    const results = response.results.map(
      element => {
        if (!element.series) {
          console.error('no result for statement ' + JSON.stringify(element));
          return {};
        }
        return element.series[0].values.reduce((obj, element) => { obj[element[0]] = element[1]; return obj; }, {});
      }
    );
    // results = [
    //   // data for query 1 in 15-min intervals:
    //   { ms-timestamp: value, ms-timestamp: value, ... },
    //   // data for query 2 in 15-min intervals:
    //   { ms-timestamp: value, ms-timestamp: value, ... },
    //   ...
    // ]
    return results;
  }

  // collect the queries from the given time series configuration and return them as an array
  function createSeriesQueryArray(series) {
    // series = {
    //   device-a: {
    //     measurement-1: {
    //       query: 'query 1',
    //     },
    //     measurement-2: {
    //       query: 'query 2',
    //     },
    //   },
    //   device-b: {
    //     measurement-3: {
    //       query: 'query 3',
    //     },
    //   },
    //   ...
    // }
    const queries = [];
    for (const device in series) {
      if (series.hasOwnProperty(device)) {
        for (const measurement in series[device]) {
          if (series[device].hasOwnProperty(measurement)) {
            if (series[device][measurement].query) {
              queries.push(series[device][measurement].query);
            }
          }
        }
      }
    }
    return queries;
    // queries = [
    //   'query 1',
    //   'query 2',
    //   'query 3',
    //   ...
    // }
  }

  // transform the given array of objects with timestamp-to-value properties to index-based arrays with 96 values,
  // apply timestamp-based filters, and use the same structure as the given device-measurement time series configuration
  function transformAndFilterResults(series, results) {

    // transform a single object with timestamp-to-value properties
    function transformAndFilterResultObject(results) {
      // results = {
      //   ms-timestamp: value,
      //   ms-timestamp: value,
      //   ...
      // }
      const timestampStart = (() => {
        switch (R.parameters.timeRange) {
          default:
          case 'last-24h':
            return R.time.timestampNowMinus24h;
          case 'today':
            return R.time.timestampToday0h;
        }
      })();
      const timestampEnd = R.time.timestampNow;
      const ra = {
        all: new Array(96).fill(0),
        today: new Array(96).fill(0),
        yesterday: new Array(96).fill(0),
      };
      for (let i = 0, timestamp = R.time.timestampNowMinus24h; i < 96; i++, timestamp += R.time.delta15min) {
        const value = results[timestamp] > 0 ? results[timestamp] : 0;
        if (timestamp >= timestampStart) {
          ra.all[i] = value;
        }
        if (timestamp < R.time.timestampToday0h) {
          ra.yesterday[i] = value;
        } else if (timestamp < timestampEnd) {
          ra.today[i] = value;
        }
      }
      return ra;
      // ra = {
      //   all: [ a, b, c, ..., zz ],
      //   today: [ 0, 0, c, ..., zz ],
      //   yesterday: [ a, b, 0, ..., 0 ],
      // }
    }

    const values = {};
    let i = 0;
    for (const device in series) {
      if (series.hasOwnProperty(device)) {
        values[device] = {};
        for (const measurement in series[device]) {
          if (series[device].hasOwnProperty(measurement)) {
            const ro = series[device][measurement].query ? results[i++] : {};
            const ra = transformAndFilterResultObject(ro);
            values[device][measurement] = {
              values: ra,
              color: series[device][measurement].color,
              valuesLast: ra.all[ra.all.length - 1],
              valuesSum: ra.all.reduce((sum, element) => { return sum + element }, 0.0),
            };
          }
        }
      }
    }
    return values;
    // values = {
    //   device-a: {
    //     measurement-1: {
    //       values: {
    //          all: [ a, b, c, ..., zz ],
    //          today: [ 0, 0, c, ..., zz ],
    //          yesterday: [ a, b, 0, ..., 0 ],
    //       },
    //       color: ...,
    //       valuesLast: zz,
    //       valuesSum: zzzz,
    //     },
    //     measurement-2: {
    //       ...,
    //     },
    //     ...
    //   },
    //   device-b: {
    //     measurement-3: {
    //       ...,
    //     },
    //   },
    //   ...
    // }
  }

  try {
    const queries = createSeriesQueryArray(series);
    const results = await executeQueries(queries);
    const values = transformAndFilterResults(series, results);
    return values;
  } catch (err) {
    console.error('query processing failed: ' + err);
    return undefined;
  }
}

//
// drawing functions
//

// draw a multi-segment donut
function drawMultiSegmentDonut(dc, circle, segments, text) {

  // helper function to draw a single segment of the donut
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

  // draw a background circle
  if (circle.color) {
    drawDonutSegment(dc, circle.x, circle.y, circle.radius, circle.lineWidth, circle.maxValue, 0, circle.maxValue, circle.color);
  }

  // draw the segments
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

  // draw the given text in the middle of the donut
  if (text) {
    dc.setTextAlignedCenter();
    dc.setFont(Font.systemFont(text.fontSize));
    dc.setTextColor(text.color);
    const height = text.fontSize * 1.2;
    dc.drawTextInRect('' + text.text, new Rect(circle.x - circle.radius, circle.y - height / 2, 2 * circle.radius, height));
  }
}

// render a multi-segment donut as an image
function imageWithMultiSegmentDonut(size, circle, segments, text) {
  const dc = new DrawContext();
  dc.size = new Size(size.width, size.height);
  dc.opaque = false;
  dc.respectScreenScale = true

  drawMultiSegmentDonut(dc, circle, segments, text);
  return dc.getImage();
}

// draw a multi-segment chart with stacked values
function drawMultiSegmentChart(dc, rect, segments, maxSum, index0) {
  const w = rect.width / segments[0].values.length;
  const lr = w / 4;

  // for each x position, stack the values
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

// render a multi-segment chart with stacked values as an image
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
// combine the data
//

// consumption mix --- photovoltaics consumption, battery consumption, grid consumption
function dataForMultiSegmentDonutConsumptionMix() {
  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.consume.valuesSum, color: V.data.series.battery.consume.color },
    { value: V.data.series.grid.consume.valuesSum, color: V.data.series.grid.consume.color }
  ];
  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  return {
    segments,
    sum,
    maxValue: Math.max(C.data.max.consumption, sum),
    text: sum.toFixed(1),
    textColor: C.data.colors.consumption,
  };
};

// grid feed
function dataForMultiSegmentDonutGridFeed() {
  const segments = [
    { value: V.data.series.grid.feed.valuesSum, color: V.data.series.grid.feed.color },
  ];
  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  return {
    segments,
    sum,
    maxValue: Math.max(C.data.max.feed, sum),
    text: sum.toFixed(1),
    textColor: V.data.series.grid.feed.color,
  };
}

// production mix --- photovoltaics consumption, battery charge, grid feed
function dataForMultiSegmentDonutProductionMix() {
  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.charge.valuesSum, color: V.data.series.battery.charge.color },
    { value: V.data.series.grid.feed.valuesSum, color: V.data.series.grid.feed.color },
  ];
  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  return {
    segments,
    sum,
    maxValue: Math.max(C.data.max.production, sum),
    text: sum.toFixed(1),
    textColor: C.data.colors.production,
  };
}

// battery charge level
function dataForMultiSegmentDonutBatteryChargeLevel() {
  if (!C.data.series.battery.level.query) {
    return null;
  }
  const level = V.data.series.battery.level.valuesLast;
  const segments = [
    { value: level, color: V.data.series.battery.level.color },
  ];
  return {
    segments,
    maxValue: 100.0,
    text: level.toFixed(0) + '%',
    textColor: V.data.series.battery.level.color,
  }
}

//
// render the data
//

// simple multi-segment donut based on given data
function imageWithMultiSegmentDonutForData(size, data) {
  if (!data) {
    return null;
  }
  return imageWithMultiSegmentDonut(
    size,
    { x: size.width / 2, y: size.height / 2, radius: (size.width - 5.5) / 2, lineWidth: 5.5, maxValue: data.maxValue, color: new Color('444444', 0.5) },
    data.segments,
    { text: data.text, fontSize: 14, color: data.textColor }
  );
};

// timeline --- consumption, grid feed, battery charge
function imageForProductionConsumptionMixTimeline(size) {
  const segments = [
    // today
    { values: V.data.series.grid.feed.values.today, color: V.data.series.grid.feed.color },
    { values: V.data.series.battery.charge.values.today, color: V.data.series.battery.charge.color },
    { values: V.data.series.grid.consume.values.today, color: V.data.series.grid.consume.color },
    { values: V.data.series.battery.consume.values.today, color: V.data.series.battery.consume.color },
    { values: V.data.series.photovoltaics.consume.values.today, color: V.data.series.photovoltaics.consume.color },
  ].concat(
    (() => {
      switch (R.parameters.timeRange) {
        default:
        case 'last-24h':
          return [
            // yesterday
            { values: V.data.series.grid.feed.values.yesterday, color: new Color(V.data.series.grid.feed.color.hex, 0.5) },
            { values: V.data.series.battery.charge.values.yesterday, color: new Color(V.data.series.battery.charge.color.hex, 0.5) },
            { values: V.data.series.grid.consume.values.yesterday, color: new Color(V.data.series.grid.consume.color.hex, 0.5) },
            { values: V.data.series.battery.consume.values.yesterday, color: new Color(V.data.series.battery.consume.color.hex, 0.5) },
            { values: V.data.series.photovoltaics.consume.values.yesterday, color: new Color(V.data.series.photovoltaics.consume.color.hex, 0.5) }
          ];
        case 'today':
          return [
            // yesterday
            { values: V.data.series.grid.feed.values.yesterday, color: C.data.colors.productionYesterday },
            { values: V.data.series.battery.charge.values.yesterday, color: C.data.colors.productionYesterday },
            { values: V.data.series.photovoltaics.consume.values.yesterday, color: C.data.colors.productionYesterday }
          ];
      }
    })());

  return imageWithMultiSegmentChart(
    size,
    { x: 0, y: 0, width: size.width, height: size.height },
    segments,
    C.data.max.sumPerSegment,
    // let the timeline start at 0:00 today
    (R.time.timestampToday0h - R.time.timestampNowMinus24h) / R.time.delta15min
  );
}

//
// build the widget
//

const widget = new ListWidget();

// add the background gradient
const gradient = new LinearGradient()
gradient.colors = C.widget.background.gradient.map((element) => element.color);
gradient.locations = C.widget.background.gradient.map((element) => element.location);
widget.backgroundGradient = gradient;

// helper function to layout a single row of the widget
function addWidgetRow(widget, width, margin, images) {
  const stack = widget.addStack();
  stack.layoutHorizontally();
  images = images.filter((element) => element !== null);
  const space = Math.max(0, width - margin * 2 - images.reduce((sum, image) => sum + image.size.width, 0));
  const count = images.length - (1 - images.length % 2);
  const spacing = {
    first: margin + (images.length % 2 ? space / count / 2 : 0),
    default: space / count,
  };
  for (let i = 0; i < images.length; i++) {
    stack.addSpacer(i === 0 ? spacing.first : spacing.default);
    stack.addImage(images[i]);
  }
}

// layout the widget based on the current widget family and the given style parameter
if (V.data.series) {
  switch (R.widget.family) {
    default:
    case 'small':
      {
        const width = (155 - 16 * 2);
        const spacerSize = 14;
        const imageDonutSize = { width: (width - spacerSize) / 2, height: (width - spacerSize) / 2 };
        switch (R.parameters.style) {
          default:
            addWidgetRow(widget, width, 0,
              [
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutConsumptionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutGridFeed()),
              ]
            );
            widget.addSpacer(spacerSize);
            addWidgetRow(widget, width, 0,
              [
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutProductionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutBatteryChargeLevel()),
              ]
            );
            break;
        }
      }
      break;
    case 'medium':
      {
        const width = (329 - 16 * 2);
        const height = (155 - 16 * 2);
        const spacerSize = 14;
        const imageDonutSize = { width: (height - spacerSize) / 2, height: (height - spacerSize) / 2 };
        switch (R.parameters.style) {
          default:
          case 1:
            // widget parameter: style=1
            addWidgetRow(widget, width, 7,
              [
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutConsumptionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutGridFeed()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutProductionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutBatteryChargeLevel()),
              ]
            );
            widget.addSpacer(spacerSize);
            addWidgetRow(widget, width, 0,
              [
                imageForProductionConsumptionMixTimeline({ width: width, height: (height - spacerSize) / 2 }),
              ]
            );
            break;
          case 2:
            // widget parameter: style=2
            widget.addSpacer(height / 2 / 2);
            addWidgetRow(widget, width, 7,
              [
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutConsumptionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutGridFeed()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutProductionMix()),
                imageWithMultiSegmentDonutForData(imageDonutSize, dataForMultiSegmentDonutBatteryChargeLevel()),
              ]
            );
            widget.addSpacer(height / 2 / 2);
            break;
          case 3:
            // widget parameter: style=3
            addWidgetRow(widget, width, 0,
              [
                imageForProductionConsumptionMixTimeline({ width: width, height: height }),
              ]
            );
            break;
        }
      }
      break;
  }
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
