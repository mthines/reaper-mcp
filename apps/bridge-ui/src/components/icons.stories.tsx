import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronIcon, CloseIcon, GearIcon, GitHubIcon, SearchIcon, ShareIcon, SparkIcon } from './icons.js';

const ICONS = { GitHubIcon, GearIcon, CloseIcon, SearchIcon, SparkIcon, ChevronIcon, ShareIcon };

const meta = {
  title: 'Components/Icons',
  component: GearIcon,
} satisfies Meta<typeof GearIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="story-row">
      {Object.entries(ICONS).map(([name, Icon]) => (
        <span key={name} className="chip" title={name}>
          <Icon /> {name}
        </span>
      ))}
    </div>
  ),
};
