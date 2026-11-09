import type { Meta, StoryObj } from '@storybook/react-vite';
import { InstallBanner } from './InstallBanner.js';

const meta = { title: 'Components/InstallBanner', component: InstallBanner } satisfies Meta<typeof InstallBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Playground: Story = {};
