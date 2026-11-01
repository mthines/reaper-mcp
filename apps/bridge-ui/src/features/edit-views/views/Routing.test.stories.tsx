import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';

const changed = editExamples('routing').find((e) => e.title === 'Send changed');

const meta = {
  title: 'Features/Edit views/Routing/Tests',
  component: EditView.Routing,
  tags: ['test'],
  args: { v: changed!.v },
} satisfies Meta<typeof EditView.Routing>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoveringAChangedSendShowsItsLevelBeforeAndAfter: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const faders = c.getAllByRole('img', { name: /dB$/ });
    for (const f of faders) {
      await userEvent.hover(f);
      const tip = c.getByRole('tooltip').textContent ?? '';
      await userEvent.unhover(f);
      if (tip.includes('→')) {
        await expect(tip).toMatch(/^Level −?\d+\.\d → −?\d+\.\d dB$/);
        return;
      }
    }
    throw new Error('no fader showed a before → after level');
  },
};

const added = editExamples('routing').find((e) => e.title === 'Send added');
const listed = editExamples('routing').find((e) => e.title === 'Routing listed');

export const RoutesSitUnderAHeadingForTheirKind: Story = {
  args: { v: added!.v },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('region', { name: 'Receives from' })).toHaveTextContent('Vox Dbl');
    await expect(c.getByRole('region', { name: 'Sends to' })).toHaveTextContent(/Verb.*Vox Bus.*Delay/);
    await expect(c.getByRole('region', { name: 'Hardware outputs' })).toHaveTextContent('Out 3/4');
  },
};

export const TheFlowShowsWhatComesInAndWhatGoesOut: Story = {
  args: { v: listed!.v },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('img', { name: 'Vox, Gtr L, Gtr R, Snare into Verb' })).toBeInTheDocument();
    await expect(c.queryByRole('region', { name: 'Sends to' })).not.toBeInTheDocument();
    await expect(c.getByText('Muted')).toBeInTheDocument();
  },
};

const big = editExamples('routing').find((e) => e.title === 'Big routing');

export const HoveringANameInTheFlowShowsItsLevelAndMarksItsRow: Story = {
  args: { v: big!.v },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const flow = c.getByRole('img', { name: /into/ });
    const name = within(flow).getByText('Room Verb');
    await userEvent.hover(name);
    await expect(await c.findByRole('tooltip')).toHaveTextContent(/^Send to Room Verb · −?\d+\.\d → −?\d+\.\d dB · pan /);
    const sends = c.getByRole('region', { name: 'Sends to' });
    await expect(within(sends).getByText('Room Verb').closest('[aria-current="true"]')).not.toBeNull();
    await userEvent.unhover(name);
    await expect(c.queryByRole('tooltip')).not.toBeInTheDocument();
    await expect(canvasElement.querySelector('[aria-current="true"]')).toBeNull();
  },
};
