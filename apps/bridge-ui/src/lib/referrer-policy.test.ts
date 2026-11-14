import { describe, expect, it } from 'vitest';
import { referrerMetaTag } from '../../build-config.mjs';

// The page views' referrer is whatever the browser puts in document.referrer, which the Web SDK sends unscrubbed;
// the page's referrer policy is the only thing that keeps the bridge page's own address out of it.
describe('the page’s referrer policy', () => {
  it('sends no referrer at all from the page REAPER serves, where even the origin can be a LAN address', () => {
    expect(referrerMetaTag(false)).toEqual({ tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' });
  });

  it('sends only its origin from the hosted site: no path, no ?bridge= address', () => {
    expect(referrerMetaTag(true).attrs).toEqual({ name: 'referrer', content: 'strict-origin' });
  });
});
