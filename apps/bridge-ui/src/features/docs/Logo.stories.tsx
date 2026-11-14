import type { Meta, StoryObj } from '@storybook/react-vite';
import { Logo } from './Logo.js';

const meta = {
  title: 'Features/Docs/Logo',
  component: Logo,
  args: { size: 28 },
} satisfies Meta<typeof Logo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20 }}>
      <Logo size={26} />
      <Logo size={56} />
    </div>
  ),
};

export const Playground: Story = {};
