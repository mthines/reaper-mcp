import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';

const mixer = editExamples('mixer').find((e) => e.title === 'Mixer');

const meta = {
  title: 'Features/Edit views/Mixer/Tests',
  component: EditView.Mixer,
  tags: ['test'],
  args: { v: mixer!.v },
} satisfies Meta<typeof EditView.Mixer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoveringAFaderOrPanShowsItsValue: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const fader = c.getByRole('img', { name: 'Gtr L −9.0 dB' });
    await userEvent.hover(fader);
    await expect(c.getByRole('tooltip')).toHaveTextContent('Volume −9.0 dB');
    await userEvent.unhover(fader);
    await expect(c.queryByRole('tooltip')).not.toBeInTheDocument();
    const pans = c.getAllByRole('img', { name: /^pan \d+% L$/ });
    await userEvent.hover(pans[0]);
    await expect(c.getByRole('tooltip')).toHaveTextContent(/^Pan \d+% left$/);
  },
};
