import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './index.js';
import listStyles from '../styles/list.module.css';

const meta = {
  title: 'Components/Icon',
  component: Icon.Gear,
} satisfies Meta<typeof Icon.Gear>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Every icon in the `Icon` namespace */
export const Default: Story = {
  render: () => (
    <div className="story-row">
      {Object.entries(Icon).map(([name, Glyph]) => (
        <span key={name} className={listStyles.chip}>
          <Glyph /> Icon.{name}
        </span>
      ))}
    </div>
  ),
};
