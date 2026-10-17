'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
// (jsdom is installed under another name, jsdom-for-tests: paper.js switches to a canvas it can't get when it finds a package called "jsdom")
const { JSDOM } = require('jsdom-for-tests');

// svgSafeParse (src/js/18b-svg-import.js) needs a DOM to read a file, so the real file runs here with jsdom's
// DOMParser. paper.js puts what svgSafeParse returns into the page for a moment while it reads it, so whatever is
// left must be harmless there: only known SVG elements and attributes, and no links or url()s out of the file.
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', '18b-svg-import.js'), 'utf8');
function load() {
  const { window } = new JSDOM('');
  const sandbox = { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, Node: window.Node, console, Math, Number, String, Array, Set, Map, Object, JSON };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: '18b-svg-import.js' });
  vm.runInContext('globalThis.__x = { svgSafeParse, SVG_ELEMENTS, SVG_IMG_MARK };', sandbox);
  const ser = new window.XMLSerializer();
  return Object.assign(sandbox.__x, { serialize: (n) => ser.serializeToString(n) });
}
const m = load();
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml" xmlns:x="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100"><rect width="50" height="50" fill="#ff0000"/>';
const clean = (inner, head = HEAD) => m.svgSafeParse(head + inner + '</svg>');
const allElements = (svg) => [svg, ...svg.getElementsByTagName('*')];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('svg import: nothing in a file can run, navigate or reach the internet', async (t) => {
  const attacks = {
    'an HTML meta refresh': '<h:meta http-equiv="refresh" content="0;url=https://evil.example/"/>',
    'an HTML picture with srcset': '<h:img srcset="https://evil.example/a.png 1x"/>',
    'an HTML preload link': '<h:link rel="preload" as="image" imagesrcset="https://evil.example/a.png 1x"/>',
    'an HTML element with a CSS background': '<h:div style="background-image:url(https://evil.example/a.png)">x</h:div>',
    'a filter picture linked under a made-up prefix': '<filter id="f"><feImage x:href="https://evil.example/a.png"/></filter><rect width="1" height="1" filter="url(#f)"/>',
    'a CSS-escaped url() in style=""': '<rect width="1" height="1" style="fill:u\\72l(https://evil.example/a.svg#p); mask-image:u\\72l(https://evil.example/m.png)"/>',
    'a CSS-escaped url() in an attribute': '<rect width="1" height="1" fill="u\\72l(https://evil.example/a.svg#p)"/>',
    'a plain outside url() in an attribute': '<rect width="1" height="1" fill="url(https://evil.example/a.svg#p)" clip-path="url(https://evil.example/c.svg#c)"/>',
    'a reused shape from another file': '<use x:href="https://evil.example/s.svg#s"/><use href="https://evil.example/s.svg#s"/>',
    'a script': '<script>alert(1)</script><h:script>alert(1)</h:script>',
    'event handlers': '<rect width="1" height="1" onclick="alert(1)" onload="alert(1)"/><svg onload="alert(1)"/>',
    'an iframe and its srcdoc': '<h:iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>',
    'a foreignObject': '<foreignObject><h:img src="https://evil.example/a.png"/></foreignObject>',
    'animation that changes a link': '<a href="#x"><set attributeName="href" to="javascript:alert(1)"/><rect width="1" height="1"/></a>',
    'a picture from the internet': '<image href="https://evil.example/a.png" width="10" height="10"/>',
    'a processing instruction inside the drawing': '<?xml-stylesheet href="https://evil.example/s.css"?>',
    'a style sheet that imports another': '<style>@import url(https://evil.example/s.css); rect { fill: url(https://evil.example/a.svg#p) }</style>',
  };
  for (const [name, inner] of Object.entries(attacks)) {
    await t.test(name, () => {
      const { svg } = clean(inner);
      const out = m.serialize(svg);
      assert.ok(!/evil\.example|javascript:|alert|refresh|srcset|xhtml|\\/i.test(out), 'left in: ' + out);
      allElements(svg).forEach((el) => {
        assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg', el.localName + ' is not an SVG element');
        assert.ok(m.SVG_ELEMENTS.has(el.localName), el.localName + ' is not on the list');
        Array.from(el.attributes).forEach((a) => {
          assert.ok(!/^on/i.test(a.localName), 'event handler ' + a.name);
          assert.ok(a.localName !== 'style' && a.localName !== 'class', a.name + ' left on ' + el.localName);
          if (a.localName === 'href') assert.ok(/^\s*#/.test(a.value) || a.value.startsWith('data:image/'), 'link ' + a.value);
          if (/url\(/i.test(a.value)) assert.ok(/^url\(\s*['"]?#/i.test(a.value.trim()), 'url ' + a.value);
        });
      });
      // nothing but elements and text
      const walk = (n) => Array.from(n.childNodes).forEach((c) => { assert.ok(c.nodeType === 1 || c.nodeType === 3 || c.nodeType === 4, 'node type ' + c.nodeType); walk(c); });
      walk(svg);
    });
  }
  await t.test('the root element itself is cleaned too', () => {
    const { svg } = m.svgSafeParse('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" style="background:url(https://evil.example/a.png)"><rect width="1" height="1"/></svg>');
    assert.equal(svg.getAttribute('onload'), null);
    assert.equal(svg.getAttribute('style'), null);
  });
  await t.test('a file whose top element is not an SVG drawing is refused', () => {
    assert.throws(() => m.svgSafeParse('<svg xmlns="http://www.w3.org/1999/xhtml"><meta http-equiv="refresh" content="0;url=https://evil.example/"/></svg>'));
    assert.throws(() => m.svgSafeParse('<html xmlns="http://www.w3.org/1999/xhtml"/>'));
  });
});

test('svg import: what FriendShaped uses is kept', async (t) => {
  await t.test('shapes, groups, gradients, text and their colors', () => {
    const { svg } = clean('<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
      '<g opacity="0.5"><rect x="1" y="2" width="3" height="4" rx="1" fill="url(#g)" stroke="#000000" stroke-width="2" transform="rotate(10)"/>' +
      '<circle cx="5" cy="5" r="4"/><path d="M0 0L10 10Z" style="fill:#123456; stroke-linejoin: round"/></g><text x="1" y="9" font-size="8">Hi</text>');
    const rect = svg.getElementsByTagName('rect')[1];
    ['x', 'y', 'width', 'height', 'rx', 'stroke', 'stroke-width', 'transform'].forEach((a) => assert.ok(rect.hasAttribute(a), a));
    assert.equal(rect.getAttribute('fill'), 'url(#g)');
    assert.equal(svg.getElementsByTagName('stop').length, 2);
    const p = svg.getElementsByTagName('path')[0];
    assert.equal(p.getAttribute('fill'), '#123456');
    assert.equal(p.getAttribute('stroke-linejoin'), 'round');
    assert.equal(svg.getElementsByTagName('text')[0].textContent, 'Hi');
    assert.equal(svg.getElementsByTagName('g')[0].getAttribute('opacity'), '0.5');
  });
  await t.test('what is inside a link stays, without the link', () => {
    const { svg } = clean('<a href="https://example.com"><circle r="3"/></a>');
    assert.equal(svg.getElementsByTagName('a').length, 0);
    assert.equal(svg.getElementsByTagName('circle').length, 1);
  });
  await t.test('reused symbols are copied in', () => {
    const { svg } = clean('<defs><symbol id="s" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs><use x:href="#s" width="20" height="20"/>');
    assert.equal(svg.getElementsByTagName('use').length, 0);
    assert.equal(svg.getElementsByTagName('circle').length, 1);
  });
  await t.test('an embedded picture becomes a marker, whatever prefix its link uses', () => {
    const r = clean('<image x:href="' + PNG + '" x="1" y="2" width="3" height="4"/><image href="' + PNG + '" width="3" height="4"/>');
    assert.equal(r.pictures.length, 2);
    assert.equal(r.pictures[0].href, PNG);
    assert.equal(r.svg.getElementsByTagName('image').length, 0);
    assert.equal(r.svg.querySelectorAll('[id^="' + m.SVG_IMG_MARK + '"]').length, 2);
  });
});
