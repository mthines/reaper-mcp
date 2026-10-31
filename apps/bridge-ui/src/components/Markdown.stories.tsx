import type { Meta, StoryObj } from '@storybook/react-vite';
import { Markdown } from './Markdown.js';

const RECORD = `## What it does

A **3-band** *saturator* with \`Heat\` and \`Drive\` per band. See the [manual](https://example.com/manual).

- Gentle on the mix bus
  - Keep Drive under 3
- Aggressive on drums

| Parameter | Range | Sweet spot |
|---|---|---|
| Drive | 0–10 | 2–4 |
| Heat | 0–100 % | 30 % |

\`\`\`
mix: 40 %
\`\`\``;

const meta = {
  title: 'Components/Markdown',
  component: Markdown,
  args: { source: RECORD },
  argTypes: { source: { control: 'text' } },
} satisfies Meta<typeof Markdown>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A plugin record's body; raw HTML shows as text and only http(s)/mailto links are kept */
export const Default: Story = {};

export const Playground: Story = {};
