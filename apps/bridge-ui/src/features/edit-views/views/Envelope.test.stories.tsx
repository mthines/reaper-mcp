import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { editExamples } from '../../../demo/examples.js';
import { EditView } from '../index.js';

const examples = editExamples('envelope');
const byTitle = (title: string) => {
  const x = examples.find((e) => e.title === title);
  if (!x) throw new Error(`no envelope example “${title}”`);
  return x.v;
};

const meta = {
  title: 'Features/Edit views/Envelope/Tests',
  component: EditView.Envelope,
  tags: ['test'],
  args: { v: byTitle('Pool edited') },
} satisfies Meta<typeof EditView.Envelope>;
export default meta;
type Story = StoryObj<typeof meta>;

export const APoolEditMarksEveryItemOfThatPoolAndStepsTheOthersBack: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Unchanged item')).toBeInTheDocument();
    const changed = c.getAllByTitle(/changed by this call/);
    await expect(changed.every((el) => el.textContent?.startsWith('Vox Chorus'))).toBe(true);
    await expect(changed.length).toBeGreaterThan(1);
    await expect(c.getAllByTitle(/^Vox Verse/).some((el) => /changed by this call/.test(el.title))).toBe(false);
  },
};

export const ANewItemIsTheOnlyOneMarkedChanged: Story = {
  args: { v: byTitle('Automation items pooled') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Unchanged item')).toBeInTheDocument();
    const changed = c.getAllByTitle(/changed by this call/);
    await expect(changed).toHaveLength(1);
  },
};

export const AListingDimsNothing: Story = {
  args: { v: examples.find((e) => e.v.ais && !e.v.was)?.v ?? byTitle('Pool edited') },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.queryByText('Unchanged item')).not.toBeInTheDocument();
    await expect(c.queryAllByTitle(/changed by this call/)).toHaveLength(0);
  },
};
