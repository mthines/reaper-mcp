// @vitest-environment jsdom
// Every story renders, and every play function passes: the stories are the components' behaviour tests.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { clearAllMocks } from 'storybook/test';
import { afterEach, describe, it } from 'vitest';
import preview from '../../.storybook/preview.js';

setProjectAnnotations(preview);
// jsdom has no layout or pointer capture: scrolling, capturing and observing sizes do nothing
Element.prototype.scrollIntoView = () => undefined;
Element.prototype.setPointerCapture = () => undefined;
Element.prototype.releasePointerCapture = () => undefined;
Element.prototype.hasPointerCapture = () => false;
window.matchMedia ??= (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type StoryModule = Parameters<typeof composeStories>[0];
const modules = import.meta.glob<StoryModule>('../**/*.stories.tsx', { eager: true });

afterEach(() => {
  document.body.innerHTML = '';
  clearAllMocks(); // a meta's fn() spy is shared by its stories
});

for (const [path, mod] of Object.entries(modules)) {
  describe(path.replace(/^\.\.\//, ''), () => {
    const stories: Record<string, { run: () => Promise<void> }> = composeStories(mod);
    for (const [name, story] of Object.entries(stories)) {
      it(name, () => story.run());
    }
  });
}
