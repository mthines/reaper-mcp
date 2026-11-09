import type { Meta, StoryObj } from '@storybook/react-vite';
import { Changelog } from './index.js';
import { EXAMPLE_HIGHLIGHTS } from './highlight-examples.js';

const meta = {
  title: 'Features/Changelog/Highlight',
  component: Changelog.Highlight,
  args: { highlight: EXAMPLE_HIGHLIGHTS[0] },
  decorators: [(Story) => <div style={{ width: 400 }}><Story /></div>],
} satisfies Meta<typeof Changelog.Highlight>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One of each kind, in the drawer's width: an animation (new), a graphic (faster), a screenshot (fixes) */
export const Default: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {EXAMPLE_HIGHLIGHTS.map((h) => (
        <Changelog.Highlight key={h.id} highlight={h} />
      ))}
    </div>
  ),
};

export const Playground: Story = {};

/** Media that won't load (offline): the stage says what it would have shown */
export const MediaMissing: Story = { args: { highlight: { ...EXAMPLE_HIGHLIGHTS[2], media: '/changelog/media/missing.webp' } } };
