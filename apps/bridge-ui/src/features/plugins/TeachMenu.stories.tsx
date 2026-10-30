import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import { pluginCoverage } from './plugins.js';
import { TeachMenu } from './TeachMenu.js';

const rows = pluginCoverage(DEMO_KNOWLEDGE);
const OPTIONS = [
  { key: 'project', label: 'Teach unknown in this project', rows: rows.filter((r) => r.coverage === 'unknown' && r.used > 0) },
  { key: 'all', label: 'Teach all unknown', rows: rows.filter((r) => r.coverage === 'unknown') },
];

const meta = {
  title: 'Features/Plugins/TeachMenu',
  component: TeachMenu,
  args: { options: OPTIONS, onCopy: fn() },
} satisfies Meta<typeof TeachMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Split button: copies a /learn-plugin prompt for the first option; the caret offers the rest */
export const Default: Story = {};

export const Playground: Story = {};

export const CopiesTheChosenOption: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'More teach options' }));
    await userEvent.click(canvas.getByRole('menuitem', { name: /Teach all unknown/ }));
    await expect(args.onCopy).toHaveBeenCalledWith('all', OPTIONS[1].rows);
  },
};
