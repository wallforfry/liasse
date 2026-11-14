import { describe, expect, it } from 'vitest';
import { normalizeText } from '../normalize.ts';
import { htmlToText } from './html-to-text.ts';

const convert = (html: string): string => normalizeText(htmlToText(html));

describe('htmlToText', () => {
  it('separates blocks with line breaks and inline elements with nothing', () => {
    expect(convert('<div>Hello <b>Jane</b> <i>Doe</i>,</div><p>Welcome.</p>Bye<br>now')).toBe(
      'Hello Jane Doe,\n\nWelcome.\nBye\nnow',
    );
  });

  it('treats source line breaks as spaces', () => {
    expect(convert('<p>Your contract\n   renews\r\non 1 March.</p>')).toBe(
      'Your contract renews on 1 March.',
    );
  });

  it.each(['script', 'style', 'head', 'title', 'template', 'noscript'])(
    'drops the content of <%s>',
    (name) => {
      expect(convert(`before<${name} type="x">secret <b>content</b></${name}>after`)).toBe(
        'beforeafter',
      );
    },
  );

  it('matches a closing tag whatever its case and spacing', () => {
    expect(convert('a<SCRIPT>alert(1)</ScRiPt >b')).toBe('ab');
  });

  it('drops everything after a skipped element that is never closed', () => {
    expect(convert('visible<script>alert(1) <p>still script</p>')).toBe('visible');
  });

  it('drops comments, declarations and processing instructions', () => {
    expect(convert('<!DOCTYPE html><?xml version="1.0"?>a<!-- hidden <p> -->b<!-- open')).toBe(
      'ab',
    );
  });

  it('keeps the address of a link after its text', () => {
    expect(
      convert('See <a class="x" href="https://example.com/contract?a=1&amp;b=2">the contract</a>.'),
    ).toBe('See the contract (https://example.com/contract?a=1&b=2).');
    expect(convert("<a href='mailto:jane.doe@example.com'>Write</a>")).toBe(
      'Write (mailto:jane.doe@example.com)',
    );
  });

  it('drops link targets that are not web or mail addresses', () => {
    expect(convert('<a href="javascript:alert(1)">Click</a> <a href="#top">Top</a>')).toBe(
      'Click Top',
    );
  });

  it('never fetches or mentions an image source', () => {
    expect(convert('Logo <img src="https://tracker.example.com/pixel.png" alt="x"> here')).toBe(
      'Logo here',
    );
  });

  it('renders list items and table cells', () => {
    expect(convert('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
    expect(convert('<table><tr><td>Rent</td><td>850.00</td></tr></table>')).toBe('Rent 850.00');
  });

  it('decodes character references once', () => {
    expect(convert('Caf&eacute;&nbsp;&amp;&#32;th&#xE9; &lt;b&gt; &yuml; &euro; &amp;lt;')).toBe(
      'Café & thé <b> ÿ € &lt;',
    );
  });

  it('leaves unknown references and stray angle brackets as text', () => {
    expect(convert('1 < 2 &unknown; &#99999999; <3')).toBe('1 < 2 &unknown; &#99999999; <3');
  });

  it('survives a tag that is never closed', () => {
    expect(convert('text <p class="unterminated')).toBe('text');
  });

  it('does not end a tag at a > inside a quoted attribute value', () => {
    expect(convert('<p title="a>S9">t')).toBe('t');
    expect(convert('<p title=\'a>S9\' class="b>c">t')).toBe('t');
    expect(convert('<a href="https://example.com/?a>b">link</a>')).toBe(
      'link (https://example.com/?a>b)',
    );
  });

  it('opens a quote only where an attribute value starts', () => {
    expect(convert("<p don't>kept</p> it's")).toBe("kept\nit's");
    expect(convert('<p class=plain>kept "as is"')).toBe('kept "as is"');
  });

  it('skips an element whose closing tag follows a quoted >', () => {
    expect(convert('a<script data-x="1>2">alert(1)</script>b')).toBe('ab');
  });
});
