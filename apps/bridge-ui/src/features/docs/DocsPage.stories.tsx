import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { Docs } from './index.js';
import { EXAMPLE_GUIDES } from './docs-examples.js';

const index = { status: 'ready', guides: EXAMPLE_GUIDES } as const;

const meta = {
  title: 'Features/Docs/DocsPage',
  component: Docs.Page,
  args: { index, slug: undefined, guide: { status: 'missing' }, onNavigate: fn(), demoHref: '/' },
} satisfies Meta<typeof Docs.Page>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The front page: what this is, then every guide under what you want to do */
export const Default: Story = {};

export const Playground: Story = {};

/** A recipe with its video, a prompt to copy and the callout */
export const Guide: Story = { args: { slug: 'second-opinion', guide: { status: 'ready', guide: EXAMPLE_GUIDES[2] } } };

/** A guide with a video id: the poster until someone presses play */
export const WithVideo: Story = { args: { slug: 'install', guide: { status: 'ready', guide: EXAMPLE_GUIDES[0] } } };

export const Loading: Story = { args: { index: { status: 'loading' } } };

export const Unreachable: Story = { args: { index: { status: 'error' } } };

export const UnknownGuide: Story = { args: { slug: 'nope', guide: { status: 'missing' } } };
