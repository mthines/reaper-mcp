import type { Meta, StoryObj } from '@storybook/react-vite';
import { exampleReleaseJson } from '../../demo/examples.js';
import { Changelog, parseReleases } from './index.js';
import { EXAMPLE_HIGHLIGHTS } from './highlight-examples.js';

const releases = parseReleases(exampleReleaseJson('0.79.0'));

const meta = {
  title: 'Features/Changelog/ChangelogPage',
  component: Changelog.Page,
  args: { releases: { status: 'ready', releases }, highlights: EXAMPLE_HIGHLIGHTS, demoHref: '/' },
} satisfies Meta<typeof Changelog.Page>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The public changelog: every release in one column, with the demo one click away */
export const Default: Story = {};

export const Playground: Story = {};

export const Loading: Story = { args: { releases: { status: 'loading' } } };

export const Unreachable: Story = { args: { releases: { status: 'error' } } };
