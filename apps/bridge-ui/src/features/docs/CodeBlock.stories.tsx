import type { Meta, StoryObj } from '@storybook/react-vite';
import { CodeBlock } from './CodeBlock.js';

const meta = {
  title: 'Features/Docs/CodeBlock',
  component: CodeBlock,
  args: { text: 'npm install -g @mthines/reaper-mcp\nreaper-mcp setup\nreaper-mcp init', lang: 'bash' },
} satisfies Meta<typeof CodeBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A terminal block, a JSON block and one with no label, side by side */
export const Default: Story = {
  render: (args) => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <CodeBlock {...args} />
      <CodeBlock text={'{ "mcpServers": { "reaper": {} } }'} lang="json" />
      <CodeBlock text="just some plain text" lang="text" />
    </div>
  ),
};

export const Playground: Story = {};
