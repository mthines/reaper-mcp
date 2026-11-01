import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';

const pick = (title: string) => {
  const x = editExamples('render').find((e) => e.title === title);
  if (!x) throw new Error(`no render example “${title}”`);
  return x.v;
};

const meta = {
  title: 'Features/Edit views/Render/Tests',
  component: EditView.Render,
  tags: ['test'],
  args: { v: pick('Render · on target') },
} satisfies Meta<typeof EditView.Render>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoveringTheWaveformShowsTimeAndPeak: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const wave = c.getByRole('img', { name: 'Waveform: peak level over time' });
    await userEvent.hover(wave);
    await expect(await c.findByRole('tooltip')).toHaveTextContent(/^\d+:\d\d\.\d · (peak −?\d+\.\d dBFS|silence)$/);
    await userEvent.unhover(wave);
    await expect(c.queryByRole('tooltip')).not.toBeInTheDocument();
  },
};
