'use strict';

//
// configuration
//

const C = {
  widget: {
    size: {
      width: 660,
      height: 280,
    },
    background: {
      gradient: [
        new Color('#181818'),
        new Color('#080808'),
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
          query: 'SELECT difference(last("value")) / 1000 FROM "photovoltaics-energy-counter-consumption" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // kWh
          color: Color.yellow(),
        },
      },
      battery: {
        charge: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-charge" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // kWh
          color: new Color('#00aaee'),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "battery-energy-counter-discharge" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // kWh
          color: Color.orange(),
        },
        level: {
          query: 'SELECT last("value") FROM "battery-charge-level" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // percentage
          color: Color.orange(),
        }
      },
      grid: {
        feed: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-out" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // kWh
          color: Color.green(),
        },
        consume: {
          query: 'SELECT difference(last("value")) / 1000 FROM "grid-energy-counter-in" WHERE time >= now() - 24h AND time <= now() GROUP BY time(15m) fill(0)', // kWh
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
// query handling
//

async function getSeriesValues(series) {

  async function executeQueries(queries) {
    function escapeURLSegment(segment) {
      return segment.replace(/[^0-9A-Za-z]/g, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
    }

    const url = `${C.data.server.url}/api/datasources/proxy/1/query?db=${escapeURLSegment(C.data.database)}&epoch=ms&q=${escapeURLSegment(queries.join(';'))}`;

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
            queries.push(series[k][sk].query);
          }
        }
      }
    }
    return queries;
  }

  function transformResults(series, results) {
    function transformResultArray(results) {
      const a = results.map(element => element[1] <= 0 ? 0 : element[1]);
      a.pop();
      return a;
    }

    const values = {};
    let i = 0;
    for (const k in series) {
      if (series.hasOwnProperty(k)) {
        values[k] = {};
        for (const sk in series[k]) {
          if (series[k].hasOwnProperty(sk)) {
            const r = transformResultArray(results[i++].series[0].values);
            values[k][sk] = {
              values: r,
              color: series[k][sk].color,
              valuesLast: r[r.length - 1],
              valuesSum: r.reduce((sum, element) => { return sum + element }, 0.0),
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

function drawMultiSegmentChart(dc, rect, segments, maxSum) {
  const w = rect.width / segments[0].values.length;
  const lr = w / 4;
  for (let i = 0, x = rect.x; i < segments[0].values.length; i++) {
    let baseValue = rect.height;
    for (let j = segments.length - 1; j >= 0; j--) {
      const value = (segments[j].values[i] / maxSum) * rect.height;
      dc.setFillColor(segments[j].color);
      baseValue -= value;
      dc.fillRect(new Rect(x + lr, rect.y + baseValue, w - lr, value));
    }
    x += w;
  }
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

const dc = new DrawContext();
dc.size = new Size(C.widget.size.width, C.widget.size.height);
dc.opaque = false;
dc.respectScreenScale = true

// consumption mix --- photovoltaics consumption, battery consumption, grid consumption
{
  const x = 70;
  const y = 70;

  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.consume.valuesSum, color: V.data.series.battery.consume.color },
    { value: V.data.series.grid.consume.valuesSum, color: V.data.series.grid.consume.color }
  ];

  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  const maxValue = C.data.max.consumption;

  drawMultiSegmentDonut(dc,
    { x, y, radius: 63, lineWidth: 13, maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 35, color: Color.white() }
  );
}

// grid feed
{
  const x = 70 + (C.widget.size.width - 2 * 70) / 3;
  const y = 70;
  const sum = V.data.series.grid.feed.valuesSum;
  const segments = [
    { value: sum, color: V.data.series.grid.feed.color },
  ];
  const maxValue = C.data.max.feed;

  drawMultiSegmentDonut(dc,
    { x, y, radius: 63, lineWidth: 13, maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 35, color: V.data.series.grid.feed.color }
  );
}

// production mix --- photovoltaics consumption, battery charge, grid feed
{
  const x = C.widget.size.width - (70 + (C.widget.size.width - 2 * 70) / 3);
  const y = 70;

  const segments = [
    { value: V.data.series.photovoltaics.consume.valuesSum, color: V.data.series.photovoltaics.consume.color },
    { value: V.data.series.battery.charge.valuesSum, color: V.data.series.battery.charge.color },
    { value: V.data.series.grid.feed.valuesSum, color: V.data.series.grid.feed.color },
  ];
  const sum = segments.reduce((sum, segment) => { return sum + segment.value }, 0.0);
  const maxValue = sum;

  drawMultiSegmentDonut(dc,
    { x, y, radius: 63, lineWidth: 13, maxValue, color: new Color('444444', 0.5) },
    segments,
    { text: sum.toFixed(1), fontSize: 35, color: Color.white() }
  );
}

// battery charge level
{
  const x = C.widget.size.width - 70;
  const y = 70;
  const level = V.data.series.battery.level.valuesLast;
  const segments = [
    { value: level, color: V.data.series.battery.level.color },
  ];

  drawMultiSegmentDonut(dc,
    { x, y, radius: 63, lineWidth: 13, maxValue: 100.0, color: new Color('444444', 0.5) },
    segments,
    { text: level.toFixed(0) + '%', fontSize: 35, color: V.data.series.battery.level.color }
  );
}

// timeline --- consumption, grid feed, battery charge
{
  drawMultiSegmentChart(dc,
    { x: 0, y: 180, width: C.widget.size.width, height: 100 },
    [
      V.data.series.grid.feed,
      V.data.series.battery.charge,
      V.data.series.grid.consume,
      V.data.series.battery.consume,
      V.data.series.photovoltaics.consume,
    ],
    C.data.max.sumPerSegment
  );
}

//
// build the widget
//

const widget = new ListWidget();

const gradient = new LinearGradient()
gradient.colors = C.widget.background.gradient;
gradient.locations = C.widget.background.gradient.map((element, index) => index);
widget.backgroundGradient = gradient;

const stack = widget.addStack();
stack.addImage(dc.getImage());

if (!config.runsInWidget) {
  await widget.presentMedium();
}
Script.setWidget(widget);
Script.complete();
