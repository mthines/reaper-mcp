// @vitest-environment jsdom
// Every story renders, and every play function passes: the stories are the components' behaviour tests.
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { clearAllMocks } from 'storybook/test';
import { afterEach, describe, it } from 'vitest';
import preview from '../../.storybook/preview.js';

setProjectAnnotations(preview);
// jsdom has no layout or pointer capture: scrolling, capturing, media queries and size observers do nothing
const nothing = () => undefined;
Element.prototype.scrollIntoView = nothing;
Element.prototype.setPointerCapture = nothing;
Element.prototype.releasePointerCapture = nothing;
Element.prototype.hasPointerCapture = () => false;
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addListener: nothing, removeListener: nothing, addEventListener: nothing, removeEventListener: nothing, dispatchEvent: () => false }) as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe = nothing;
  unobserve = nothing;
  disconnect = nothing;
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
