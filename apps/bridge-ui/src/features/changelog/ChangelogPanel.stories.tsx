import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { exampleReleaseJson } from '../../demo/examples.js';
import { Changelog, parseReleases } from './index.js';
import { EXAMPLE_HIGHLIGHTS } from './highlight-examples.js';

const CURRENT = '0.79.0';
const releases = parseReleases(exampleReleaseJson(CURRENT));

const meta = {
  title: 'Features/Changelog/ChangelogPanel',
  component: Changelog,
  args: {
    releases: { status: 'ready', releases },
    highlights: EXAMPLE_HIGHLIGHTS,
    current: CURRENT,
    canUpdate: true,
    onUpdate: fn(),
    onClose: fn(),
  },
  decorators: [(Story) => <div className="story-drawer"><Story /></div>],
} satisfies Meta<typeof Changelog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A newer release is out and this install can update itself: Update on top, the new release marked, its highlights first */
export const Default: Story = {};

export const Playground: Story = {};

/** An npm install or a clone without update config: the commands instead of a button */
export const UpdateByHand: Story = { args: { canUpdate: false } };

/** On the newest release */
export const UpToDate: Story = { args: { current: '0.80.0' } };

export const Updating: Story = {
  args: { update: { kind: 'update', state: 'running', startedAt: 0, log: ['Building the server…'] } },
};

export const UpdateFailed: Story = {
  args: { update: { kind: 'update', state: 'failed', startedAt: 0, log: ['git pull refused: local changes'] } },
};

export const Loading: Story = { args: { releases: { status: 'loading' } } };

export const GitHubUnreachable: Story = { args: { releases: { status: 'error' } } };

/** No hand-made highlights: the plain release notes alone */
export const NotesOnly: Story = { args: { highlights: [] } };
