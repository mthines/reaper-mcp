import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SNAPSHOT_EXAMPLES } from '../../demo/examples.js';
import { StoryCard } from '../../demo/StoryCard.js';
import { SaveForm, SaveFormPreview } from './SaveForm.js';

const snapshots = SNAPSHOT_EXAMPLES[0].feed?.snapshots ?? [];
const forms = SNAPSHOT_EXAMPLES.filter((x) => x.saveForm);

const meta = {
  title: 'Features/Snapshots/SaveForm',
  component: SaveForm,
  args: { snapshots, blocked: null, saving: false, onSave: fn() },
  argTypes: { blocked: { control: 'text' } },
} satisfies Meta<typeof SaveForm>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Save the current mix: empty, a name that replaces a snapshot, and the replace prompt */
export const Default: Story = {
  render: (args) => (
    <div className="story-stack">
      <StoryCard title="Empty">
        <SaveForm {...args} />
      </StoryCard>
      {forms.map((x) => (
        <StoryCard key={x.title} title={x.title} note={x.note}>
          <SaveFormPreview snapshots={x.feed?.snapshots ?? []} name={x.saveForm?.name ?? ''} confirm={x.saveForm?.confirm} />
        </StoryCard>
      ))}
      <StoryCard title="Saving">
        <SaveForm {...args} saving />
      </StoryCard>
      <StoryCard title="Read-only">
        <SaveForm {...args} blocked="Read-only: turn it off in Settings to restore or save snapshots" />
      </StoryCard>
    </div>
  ),
};

export const Playground: Story = {};
