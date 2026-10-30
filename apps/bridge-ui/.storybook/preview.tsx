import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';
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
