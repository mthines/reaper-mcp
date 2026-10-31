import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ResizeHandle } from './ResizeHandle.js';
import drawerStyles from '../styles/drawer.module.css';

const meta = {
  title: 'Components/ResizeHandle',
  component: ResizeHandle,
  args: { fraction: null, onCommit: fn() },
  argTypes: { fraction: { control: { type: 'range', min: 0.15, max: 0.7, step: 0.01 } } },
  decorators: [
    (Story) => (
      // The handle resizes the drawer it sits in
      <div className="story-drawer">
        <aside className={drawerStyles.drawer}>
          <Story />
        </aside>
      </div>
    ),
  ],
} satisfies Meta<typeof ResizeHandle>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The drawer's left edge: drag, double-click to reset, or focus it and use the arrow keys */
export const Default: Story = {};

export const Playground: Story = {};
