import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Docs } from './index.js';
import { EXAMPLE_GUIDES } from './docs-examples.js';

const meta = {
  title: 'Features/Docs/DocsPage/Tests',
  component: Docs.Page,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  args: { index: { status: 'ready', guides: EXAMPLE_GUIDES }, slug: undefined, guide: { status: 'missing' }, onNavigate: fn(), demoHref: '/demo-here' },
} satisfies Meta<typeof Docs.Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ListsGuidesBySectionAndLinksToTheDemo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = within(canvas.getByRole('navigation', { name: 'Guides' }));
    for (const title of ['Getting started', 'Things to try', 'Reference']) await expect(nav.getByText(title)).toBeInTheDocument();
    await expect(nav.queryByText('Safety and privacy')).not.toBeInTheDocument(); // no guide in it yet
    await expect(canvas.getByRole('link', { name: 'Try the live demo' })).toHaveAttribute('href', '/demo-here');
  },
};

/** The front page has one obvious first click, then the path in order */
export const OffersOneWayInAndTheStepsInOrder: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('A music assistant inside REAPER');
    await userEvent.click(canvas.getByRole('link', { name: 'Start here' }));
    await expect(args.onNavigate).toHaveBeenCalledWith('what-this-is');
    const steps = within(canvas.getByRole('region', { name: 'Getting started' })).getAllByRole('listitem');
    await expect(steps[0]).toHaveTextContent('Install and connect'); // order 1 in the example data
  },
};

export const OpensAGuideFromTheNavWithoutLeavingThePage: Story = {
  play: async ({ canvasElement, args }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Guides' }));
    await userEvent.click(nav.getByRole('link', { name: 'Install and connect' }));
    await expect(args.onNavigate).toHaveBeenCalledWith('install');
  },
};

export const MarksTheCurrentGuideAndOffersTheNextOne: Story = {
  args: { slug: 'install', guide: { status: 'ready', guide: EXAMPLE_GUIDES[0] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'Install and connect', current: 'page' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 1, name: 'Install and connect' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /Next\s*What this is/ })).toHaveAttribute('href', '/docs/what-this-is');
  },
};

/** Nothing reaches YouTube until the viewer presses play */
export const LoadsTheVideoOnlyAfterAClick: Story = {
  args: { slug: 'install', guide: { status: 'ready', guide: EXAMPLE_GUIDES[0] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('iframe')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Play video: Install and connect' }));
    await expect(canvasElement.querySelector('iframe')?.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  },
};

export const SaysSoWhenTheVideoIsNotThereYet: Story = {
  args: { slug: 'second-opinion', guide: { status: 'ready', guide: EXAMPLE_GUIDES[2] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Video coming soon/)).toBeInTheDocument();
    await expect(canvasElement.querySelector('iframe')).toBeNull();
  },
};

export const ShowsThePromptToCopyAndWhatStaysYours: Story = {
  args: { slug: 'second-opinion', guide: { status: 'ready', guide: EXAMPLE_GUIDES[2] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('/critique Roast my mix')).toBeInTheDocument();
    await expect(canvas.getByLabelText('Your call')).toHaveTextContent('A critique is a to-do list.');
    await expect(canvas.getByRole('button', { name: 'Copy the prompt' })).toBeInTheDocument();
  },
};

export const SaysWhenAGuideDoesNotExist: Story = {
  args: { slug: 'nope', guide: { status: 'missing' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: /isn’t here/ })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Back to all guides' })).toHaveAttribute('href', '/docs');
  },
};

export const ShowsCommandsInABlockWithOneCopyButton: Story = {
  args: { slug: 'install', guide: { status: 'ready', guide: EXAMPLE_GUIDES[0] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Terminal')).toBeInTheDocument();
    await expect(canvas.getByText(/npm install -g @mthines\/reaper-mcp/)).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy the terminal commands' })).toBeInTheDocument();
  },
};

export const OffersTheWayBackToTheBridgeAndOpensGuidesFromThePalette: Story = {
  args: { bridgeUrl: 'http://127.0.0.1:8099/mcp_bridge.html' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: /Back to the bridge/ })).toHaveAttribute('href', 'http://127.0.0.1:8099/mcp_bridge.html');
    await expect(canvas.queryByRole('link', { name: 'Try the live demo' })).not.toBeInTheDocument();
  },
};
