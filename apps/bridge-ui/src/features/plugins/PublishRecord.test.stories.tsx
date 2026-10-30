import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import type { KnowledgeFeed } from './plugins.js';
import { PublishRecord } from './PublishRecord.js';

const [mine] = DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'user');

/** LoreKit's answer to a publish: the built-in key, and whether the copy was archived as asked */
const published: NonNullable<KnowledgeFeed['publish']> = async (record, { removeCopy }) => ({ key: record.key.replace(/^user::/, ''), removedCopy: removeCopy });

const meta = {
  title: 'Features/Plugins/PublishRecord/Tests',
  component: PublishRecord,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { record: mine, publish: fn(published) },
} satisfies Meta<typeof PublishRecord>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PublishesAfterConfirmingAndArchivesTheCopy: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Publish to built-in/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(args.publish).toHaveBeenCalledWith(mine, { removeCopy: true });
    await expect(await canvas.findByRole('status')).toHaveTextContent(/Published as .*Your copy is archived/);
  },
};

export const KeepsTheCopyWhenAsked: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Publish to built-in/ }));
    await userEvent.click(canvas.getByRole('checkbox', { name: /Archive my copy/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(args.publish).toHaveBeenCalledWith(mine, { removeCopy: false });
  },
};

export const ShowsARefusalAndOffersARetry: Story = {
  args: { publish: fn<NonNullable<KnowledgeFeed['publish']>>().mockRejectedValue(new Error('This token is not allowed to write in reaper-mcp')) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Publish to built-in/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/not allowed/);
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  },
};
