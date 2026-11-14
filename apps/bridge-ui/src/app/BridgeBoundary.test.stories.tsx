import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { BridgeBoundary } from './BridgeBoundary.js';

/** Stands in for the bridge view: breaks while `broken`, the way a translated page breaks React's DOM update. */
function View({ broken }: { broken: boolean }) {
  if (broken) throw new DOMException("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.", 'NotFoundError');
  return <p>Bridge view</p>;
}

/** The page around the boundary: a header that must survive, and a button standing in for the bridge changing state. */
function Page() {
  const [state, setState] = useState<'live' | 'offline'>('live');
  const [broken, setBroken] = useState(false);
  return (
    <div>
      <header>Header</header>
      <button type="button" onClick={() => setBroken(true)}>
        Break the view
      </button>
      <button
        type="button"
        onClick={() => {
          setBroken(false);
          setState((s) => (s === 'live' ? 'offline' : 'live'));
        }}
      >
        Bridge changes state
      </button>
      <BridgeBoundary resetKey={state}>
        <View broken={broken} />
      </BridgeBoundary>
    </div>
  );
}

const meta = {
  title: 'App/BridgeBoundary/Tests',
  component: Page,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
} satisfies Meta<typeof Page>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AnErrorInTheBridgeViewLeavesThePageUpAndRecoversOnTheNextStateChange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Bridge view')).toBeInTheDocument();

    // React reports an error a boundary caught on the console; this one is expected
    const consoleError = console.error;
    console.error = () => undefined;
    try {
      await userEvent.click(canvas.getByRole('button', { name: 'Break the view' }));
    } finally {
      console.error = consoleError;
    }
    await expect(canvas.queryByText('Bridge view')).not.toBeInTheDocument();
    await expect(canvas.getByRole('status')).toHaveTextContent('Part of this page broke');
    await expect(canvas.getByText('Header')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Bridge changes state' }));
    await expect(canvas.getByText('Bridge view')).toBeInTheDocument();
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument();
  },
};
