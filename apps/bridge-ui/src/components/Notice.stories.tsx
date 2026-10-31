import type { Meta, StoryObj } from '@storybook/react-vite';
import { Notice } from './Notice.js';

const meta = {
  title: 'Components/Notice',
  component: Notice,
  args: { tone: 'warn', children: 'SWS isn’t installed. Some envelope tools fall back to slower paths.' },
  argTypes: { tone: { control: 'select', options: ['info', 'warn', 'bad'] }, children: { control: 'text' } },
} satisfies Meta<typeof Notice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-stack">
      <Notice tone="info" action={<button className="btn btn-sm">Rebuild &amp; reload</button>}>
        <b>Source changed since the last install.</b> Rebuild to try it.
      </Notice>
      <Notice tone="warn">
        <b>SWS isn’t installed.</b> Some envelope tools fall back to slower paths.
      </Notice>
      <Notice tone="bad" action={<button className="btn btn-sm">Restart bridge</button>}>
        <b>The bridge script is outdated.</b> Setup installed a newer copy.
      </Notice>
    </div>
  ),
};

export const Playground: Story = {};
