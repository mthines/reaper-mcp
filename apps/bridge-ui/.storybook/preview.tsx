import type { Preview } from '@storybook/react-vite';
// The page's stylesheet order (see src/main.tsx): root sheet, shared modules, then each component's module
import '../src/styles.css';
import '../src/styles/chart.module.css';
import '../src/styles/drawer.module.css';
import '../src/styles/list.module.css';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <div className="story-stage">
        <Story />
      </div>
    ),
  ],
};

export default preview;
