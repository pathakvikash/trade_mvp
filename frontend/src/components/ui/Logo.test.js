import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Logo from './Logo';

test('standalone mark is an labelled image', () => {
  const html = renderToStaticMarkup(<Logo />);
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Paperline"');
});

test('wordmark names it once; the svg is hidden', () => {
  const html = renderToStaticMarkup(<Logo withWordmark />);
  expect(html).toContain('>Paperline<');
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain('role="img"');
});

test('decorative mark is hidden', () => {
  expect(renderToStaticMarkup(<Logo decorative />)).toContain('aria-hidden="true"');
});
