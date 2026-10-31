import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';
import chartStyles from '../../../styles/chart.module.css';

const cut = editExamples('timeline').find((x) => x.entry.c === 'remove_time') ?? editExamples('timeline')[0];

const meta = {
  title: 'Features/Edit views/Timeline/Tests',
  component: EditView.Timeline,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { v: cut.v },
  decorators: [(Story) => <div className={chartStyles.measure}><div className={chartStyles.measureBody}><Story /></div></div>],
} satisfies Meta<typeof EditView.Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ZoomsToTheChangeAndShowsTheWholeProjectOnRequest: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^2:16–2:48 of 3:20$/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Whole' }));
    await expect(canvas.getByText(/^0:00–3:20, the whole project$/)).toBeInTheDocument();
    await expect(canvas.getByText('0:00')).toBeInTheDocument();
    // The choice is remembered for the next view, and the next visit
    await expect(localStorage.getItem('mcp-bridge-zoom')).toBe('whole');
    await userEvent.click(canvas.getByRole('button', { name: 'Change' }));
    await expect(canvas.getByText(/^2:16–2:48/)).toBeInTheDocument();
  },
};
