import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InfoLine } from '../../src/components/crm/Ui';

/**
 * A phone number shown inside the Arabic (right to left) layout keeps its
 * reading order: "+201000009002", not "201000009002+".
 */
describe('InfoLine', () => {
  it('isolates a left-to-right value so the Arabic layout does not reorder it', () => {
    const html = renderToStaticMarkup(createElement(InfoLine, { icon: 'phone', label: 'الهاتف', value: '+201000009002', ltr: true }));
    expect(html).toContain('<bdi dir="ltr">+201000009002</bdi>');
  });

  it('leaves ordinary text in the page direction', () => {
    const html = renderToStaticMarkup(createElement(InfoLine, { icon: 'phone', label: 'الهاتف', value: 'غير مسجل' }));
    expect(html).not.toContain('dir=');
    expect(html).toContain('غير مسجل');
  });
});
