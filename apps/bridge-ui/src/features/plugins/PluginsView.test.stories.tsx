import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import { EXAMPLE_NOW } from '../../demo/examples.js';
import { Plugins } from './index.js';

const meta = {
  title: 'Features/Plugins/PluginsView/Tests',
  component: Plugins,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { feed: DEMO_KNOWLEDGE, query: '', now: EXAMPLE_NOW, onOpenSettings: fn() },
} satisfies Meta<typeof Plugins>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OpensAPluginInTheDrawer: Story = {
  args: { query: 'Pro-Q' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole('button', { name: /Pro-Q/ })[0]);
    const drawer = canvas.getByRole('complementary', { name: /^Plugin Pro-Q/ });
    await expect(drawer).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await expect(canvas.queryByRole('complementary', { name: /^Plugin/ })).toBeNull();
  },
};

export const FiltersToTheUnknownPlugins: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const unknown = canvas.getByRole('tab', { name: /Unknown/ });
    await userEvent.click(unknown);
    await expect(unknown).toHaveAttribute('aria-selected', 'true');
    // Every row left is one to teach, as many as the tab counts
    const count = Number(unknown.querySelector('.count')?.textContent);
    await expect(count).toBeGreaterThan(0);
    await expect(canvas.getAllByRole('button', { name: /^Teach$/ })).toHaveLength(count);
  },
};
