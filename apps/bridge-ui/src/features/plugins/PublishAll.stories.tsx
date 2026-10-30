import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import type { KnowledgeFeed } from './plugins.js';
import { PublishAll } from './PublishAll.js';

const mine = DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'user');
const builtIn = DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'built-in');

/** LoreKit's answer to a publish: the built-in key, and whether the copy was archived as asked */
const published: NonNullable<KnowledgeFeed['publish']> = async (record, { removeCopy }) => ({ key: record.key.replace(/^user::/, ''), removedCopy: removeCopy });

const meta = {
  title: 'Features/Plugins/PublishAll',
  component: PublishAll,
  args: { records: mine, builtIn, onClose: fn(), publish: fn(published) },
} satisfies Meta<typeof PublishAll>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Publish every one of your records in turn, carrying on past a failure */
export const Default: Story = {};

export const Playground: Story = {};

export const PublishesEachRecordInTurn: Story = {
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: `Publish ${mine.length}` }));
    await expect(args.publish).toHaveBeenCalledTimes(mine.length);
  },
};
