import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';

describe('App', () => {
  it('renders only a bg-0 page containing Till0', () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain('Till0');
    expect(markup).toContain('bg-bg-0');
  });
});
