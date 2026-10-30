import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DEMO_KNOWLEDGE } from '../../demo/demo-plugins.js';
import type { KnowledgeFeed } from './plugins.js';
import { PublishRecord } from './PublishRecord.js';

const mine = DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'user');
const builtIn = DEMO_KNOWLEDGE.records.filter((r) => r.layer === 'built-in');

/** LoreKit's answer to a publish: the built-in key, and whether the copy was archived as asked */
const published: NonNullable<KnowledgeFeed['publish']> = async (record, { removeCopy }) => ({ key: record.key.replace(/^user::/, ''), removedCopy: removeCopy });

const meta = {
  title: 'Features/Plugins/PublishRecord',
  component: PublishRecord,
  args: { record: mine[0], shadows: builtIn[0], publish: fn(published) },
} satisfies Meta<typeof PublishRecord>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Publish one of your records to the built-in layer, confirmed inline */
export const Default: Story = {};

export const Playground: Story = {};
