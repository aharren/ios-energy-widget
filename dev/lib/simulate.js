// simulation of a Scriptable.app environnment -- what was required so far; not pixel-perfect ;)

async function simulate(_script, _settings) {

  // internals
  const _ = {
    lib: {
      got: require('got'),
      canvas: require('canvas'),
    },

    output: {
      console: [],
      image: {
        data: '',
        width: 1024,
        height: 1024,
      },
    },

    scale: 3,

    log: (layer, type, text) => {
      _.output.console.push(`${new Date().toISOString()} ${layer} ${type} ${typeof text === 'object' ? JSON.stringify(text) : text}`);
    },
  }

  // args
  const args = {
    widgetParameter: _settings.widgetParameter || '',
  }

  // config
  const config = {
    runsInWidget: false,
    widgetFamily: _settings.widgetFamily || '',
  }

  // console
  const console = {
    log: (text) => {
      _.log('W', 'I', text);
    },
    error: (text) => {
      _.log('W', 'E', text);
    }
  }

  // Request
  class Request {
    constructor(url) {
      this._url = url;
      this._headers = {};
    }

    set headers(headers) {
      this._headers = headers;
    }

    async loadJSON() {
      const response = await _.lib.got(this._url, { headers: this._headers });
      return JSON.parse(response.body);
    }
  }

  // Color
  class Color {
    constructor(hex, alpha = 1) {
      try {
        const components = hex.match(/^[#]?([0-9a-z][0-9a-z])([0-9a-z][0-9a-z])([0-9a-z][0-9a-z])$/i);
        this._red = parseInt(components[1], 16);
        this._green = parseInt(components[2], 16);
        this._blue = parseInt(components[3], 16);

        this._hex = hex;
        this._alpha = alpha;
      } catch (err) {
        throw new Error(`Failed to construct Color('${hex}', ${alpha}): ${err}`);
      }
    }

    get hex() {
      return this._hex;
    }
    get alpha() {
      return this._alpha;
    }

    static red() {
      return new Color('ff0000');
    }
    static green() {
      return new Color('00ff00');
    }
    static blue() {
      return new Color('0000ff');
    }
    static yellow() {
      return new Color('ffff00');
    }
    static orange() {
      return new Color('ffa500');
    }
    static white() {
      return new Color('ffffff');
    }
    static black() {
      return new Color('000000');
    }

    // internals
    _rgba() {
      return `rgba(${this._red},${this._green},${this._blue},${this._alpha})`;
    }
  }

  // Size
  class Size {
    constructor(width, height) {
      this._width = width;
      this._height = height;
    }

    get width() {
      return this._width;
    }
    get height() {
      return this._height;
    }
  }

  // Rect
  class Rect {
    constructor(x, y, width, height) {
      this._x = x;
      this._y = y;
      this._width = width;
      this._height = height;
    }

    get x() {
      return this._x;
    }
    get y() {
      return this._y;
    }
    get width() {
      return this._width;
    }
    get height() {
      return this._height;
    }
  }

  // Font
  class Font {
    constructor(name, size) {
      this._name = name;
      this._size = size;
      this._sizeType = 'px';
    }

    static systemFont(size) {
      return new Font('SF Pro', `${size}`);
    }

    // internals
    _font() {
      return `${this._size * _.scale}${this._sizeType} ${this._name}`;
    }
  }

  // DrawContext
  class DrawContext {
    constructor() {
      this._size = new Size(1024, 1024);
      this._opaque = true;
      this._respectScreenScale = false;
      this._textAlignment = 'left';
    }

    get size() {
      return this._size;
    }
    set size(size) {
      this._size = size;
      delete this.__canvas;
      delete this.__context;
    }

    setStrokeColor(color) {
      this._strokeColor = color;
    }
    setFillColor(color) {
      this._fillColor = color;
    }
    setLineWidth(width) {
      this._lineWidth = width;
    }
    strokeEllipse(rect) {
      const rx = rect.width / 2;
      const ry = rect.height / 2;
      const x = rect.x + rx;
      const y = rect.y + ry;
      this._context.lineWidth = this._lineWidth * _.scale;
      this._context.strokeStyle = this._strokeColor._rgba();
      this._context.beginPath();
      this._context.ellipse(x * _.scale, y * _.scale, rx * _.scale, ry * _.scale, 0, 0, 2 * Math.PI);
      this._context.stroke();
    }
    fillEllipse(rect) {
      const rx = rect.width / 2;
      const ry = rect.height / 2;
      const x = rect.x + rx;
      const y = rect.y + ry;
      this._context.lineWidth = this._lineWidth * _.scale;
      this._context.fillStyle = this._fillColor._rgba();
      this._context.beginPath();
      this._context.ellipse(x * _.scale, y * _.scale, rx * _.scale, ry * _.scale, 0, 0, 2 * Math.PI);
      this._context.fill();
    }
    fillRect(rect) {
      this._context.lineWidth = this._lineWidth;
      this._context.fillStyle = this._fillColor._rgba();
      this._context.fillRect(rect.x * _.scale, rect.y * _.scale, rect.width * _.scale, rect.height * _.scale);
    }
    setTextAlignedCenter() {
      this._textAlignment = 'center';
    }
    setFont(font) {
      this._font = font;
    }
    setTextColor(color) {
      this._textColor = color;
    }
    drawTextInRect(text, rect) {
      this._context.textAlign = 'start';
      this._context.textBaseline = 'top';
      this._context.font = this._font._font();
      this._context.lineWidth = this._lineWidth * _.scale;
      this._context.fillStyle = this._textColor._rgba();
      const offsets = (() => {
        switch (this._textAlignment) {
          default:
            return { x: 0, y: 0 };
          case 'center':
            const metrics = this._context.measureText(text);
            return { x: (rect.width - metrics.width / _.scale) / 2, y: 3 };
        }
      })();
      this._context.fillText(text, (rect.x + offsets.x) * _.scale, (rect.y + offsets.y) * _.scale);
    }
    getImage() {
      return {
        canvas: this._canvas,
        size: this._size,
      }
    }

    // internals
    get _canvas() {
      if (!this.__canvas) {
        this.__canvas = _.lib.canvas.createCanvas(this._size.width * _.scale, this._size.height * _.scale);
      }
      return this.__canvas;
    }
    get _context() {
      if (!this.__context) {
        this.__context = this._canvas.getContext('2d');
      }
      return this.__context;
    }
  }

  // WidgetStack
  class WidgetStack {
    constructor() {
      this._objects = [];
      this._layout = 'horizontally';
    }

    layoutHorizontally() {
      this._layout = 'horizontally';
    }
    layoutVertically() {
      this._layout = 'vertically';
    }

    addImage(image) {
      this._objects.push({ type: 'image', image });
    }
    addSpacer(size) {
      this._objects.push({ type: 'spacer', size });
    }
  }

  // ListWidget
  class ListWidget {
    constructor() {
      this._objects = [];
      this._family = 'small';
      this._borderRadius = 17;
      this._margin = { top: 16, left: 16 };
    }

    addStack() {
      const stack = new WidgetStack();
      this._objects.push({ type: 'stack', stack });
      return stack;
    }
    addSpacer(size) {
      this._objects.push({ type: 'spacer', size });
    }

    presentSmall() {
      this._family = 'small';
      this._borderRadius = 22;
    }
    presentMedium() {
      this._family = 'medium';
      this._borderRadius = 22;
    }

    set backgroundGradient(gradient) {
      this._backgroundGradient = gradient;
    }

    // internals
    get _imageSize() {
      switch (this._family) {
        default:
        case 'small':
          return new Size(155 * _.scale, 155 * _.scale);
        case 'medium':
          return new Size(329 * _.scale, 155 * _.scale);
      }
    }
    _renderAsImage() {
      const size = this._imageSize;
      const canvas = _.lib.canvas.createCanvas(size.width, size.height);
      const context = canvas.getContext('2d');

      const corners = [
        { x: 0, y: 0, r: this._borderRadius * _.scale },
        { x: size.width, y: 0, r: this._borderRadius * _.scale },
        { x: size.width, y: size.height, r: this._borderRadius * _.scale },
        { x: 0, y: size.height, r: this._borderRadius * _.scale },
      ];
      context.beginPath();
      context.moveTo(corners[0].x, corners[0].y + corners[0].r);
      context.quadraticCurveTo(corners[0].x, corners[0].y, corners[0].x + corners[0].r, corners[0].y);
      context.lineTo(corners[1].x - corners[1].r, corners[1].y);
      context.quadraticCurveTo(corners[1].x, corners[1].y, corners[1].x, corners[1].y + corners[1].r);
      context.lineTo(corners[2].x, corners[2].y - corners[2].r);
      context.quadraticCurveTo(corners[2].x, corners[2].y, corners[2].x - corners[2].r, corners[2].y);
      context.lineTo(corners[3].x + corners[3].r, corners[3].y);
      context.quadraticCurveTo(corners[3].x, corners[3].y, corners[3].x, corners[3].y - corners[3].r);
      context.closePath();
      context.clip();

      if (this._backgroundGradient) {
        const gradient = context.createLinearGradient(0, 0, 0, size.height);
        for (let i = 0; i < this._backgroundGradient._colors.length; i++) {
          gradient.addColorStop(this._backgroundGradient._locations[i], this._backgroundGradient._colors[i]._rgba());
        }
        context.fillStyle = gradient;
        context.fillRect(0, 0, size.width, size.height);
      }

      const spacing = { x: 0, y: 0 };
      let x = this._margin.left;
      let y = this._margin.top;
      for (let i = 0; i < this._objects.length; i++) {
        const row = this._objects[i];
        let height = 0;
        switch (row.type) {
          default:
            break;
          case 'spacer':
            y += row.size;
            break;
          case 'stack':
            {
              for (let j = 0; j < row.stack._objects.length; j++) {
                if (j > 0) {
                  x += spacing.x;
                }
                const column = row.stack._objects[j];
                switch (column.type) {
                  default:
                    break;
                  case 'spacer':
                    x += column.size;
                    break;
                  case 'image':
                    context.drawImage(column.image.canvas, x * _.scale, y * _.scale);
                    x += column.image.size.width;
                    height = Math.max(height, column.image.size.height);
                    break;
                }
              }
              break;
            }
        }

        x = this._margin.left;
        y += height;
      }

      const buffer = canvas.toBuffer('image/png', { compressionLevel: 0, filters: _.lib.canvas.PNG_FILTER_NONE, resolution: 72 * _.scale });
      return buffer;
    }
  }

  // LinearGradient
  class LinearGradient {
    constructor() {
      this._colors = [];
      this._locations = [];
    }

    set colors(colors) {
      this._colors = colors;
    }
    set locations(locations) {
      this._locations = locations;
    }
  }

  // Script
  class Script {
    static setWidget(widget) {
      this._widget = widget;
    }
    static complete() {
      _.output.image.data = this._widget._renderAsImage().toString('base64');
      const size = this._widget._imageSize;
      _.output.image.width = size.width;
      _.output.image.height = size.height;
      _.output.image.scale = _.scale;
      _.output.image.ppi = 72 * _.scale;
    }
  }

  const widget = eval('async () => { ' + _script + ' }');
  try {
    _.log('F', 'I', 'Running widget...');
    await widget();
    _.log('F', 'I', 'Done');
  } catch (err) {
    _.log('F', 'E', '' + err);
    throw err;
  }

  return _.output;
}

module.exports = simulate;
