import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { CommandProvider } from './index.js';
import { Harness } from './CommandPalette.stories.js';

const meta = {
  title: 'Features/Command/CommandPalette/Tests',
  component: Harness,
  tags: ['test'],
  parameters: { chromatic: { disableSnapshot: true } },
  decorators: [
    (Story) => (
      <CommandProvider>
        <Story />
      </CommandProvider>
    ),
  ],
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

const ran = (c: HTMLElement) => c.querySelector('output')?.textContent;
const body = (c: HTMLElement) => within(c.ownerDocument.body);

export const RunsACommandChosenFromThePalette: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const search = await body(canvasElement).findByRole('combobox', { name: 'Search commands' });
    await userEvent.type(search, 'errors');
    await expect(body(canvasElement).getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    // It fades out first, then leaves
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull());
    await expect(ran(canvasElement)).toBe('Show only errors');
  },
};

export const FindsACommandByItsDescription: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await body(canvasElement).findByRole('combobox'), 'keeps its history');
    await expect(body(canvasElement).getByRole('option', { name: /Clear the log/ })).toBeVisible();
  },
};

export const ShowsEachCommandsShortcutAndClosesOnEscape: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const calls = await body(canvasElement).findByRole('option', { name: /Go to Calls/ });
    await expect(calls).toHaveTextContent('G C');
    await userEvent.keyboard('{Escape}');
    // It fades out first, then leaves
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull());
  },
};

export const DrillsIntoACommandsList: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.click(await body(canvasElement).findByRole('option', { name: /Rename a snapshot/ }));
    await userEvent.click(await body(canvasElement).findByRole('option', { name: 'AB-2 tight bass' }));
    await expect(ran(canvasElement)).toBe('Rename AB-2 tight bass');
  },
};

export const RunsAChordAndASingleKey: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('gs');
    await expect(ran(canvasElement)).toBe('Go to Snapshots');
    await userEvent.keyboard('f');
    await expect(ran(canvasElement)).toBe('Show only errors');
  },
};

export const LeavesKeysAloneWhileTypingInAField: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Filter' });
    await userEvent.type(field, 'gcf');
    await expect(field).toHaveValue('gcf');
    await expect(ran(canvasElement)).toBe('nothing yet');
  },
};

export const ListsEveryShortcutOnTheQuestionMarkSheet: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('?');
    const sheet = await body(canvasElement).findByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(within(sheet).getByText('Go to Calls')).toBeVisible();
    await expect(within(sheet).getByText('Show only errors')).toBeVisible();
    // A command without a key is only in the palette
    await expect(within(sheet).queryByText('Clear the log')).toBeNull();
    await userEvent.keyboard('{Escape}');
    // It fades out first, then leaves
    await waitFor(() => expect(body(canvasElement).queryByRole('dialog')).toBeNull());
  },
};

export const MarksAMenuAndListsItsItemsWhenYouSearch: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const menu = await body(canvasElement).findByRole('option', { name: /Rename a snapshot/ });
    // A menu says so, and the plain actions beside it don't
    await expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    await expect(body(canvasElement).getByRole('option', { name: /Clear the log/ })).not.toHaveAttribute('aria-haspopup');
    // Searching reaches the items, named with the menu they belong to
    await userEvent.type(body(canvasElement).getByRole('combobox'), 'tight');
    const item = await body(canvasElement).findByRole('option', { name: /AB-2 tight bass/ });
    await expect(item).toHaveTextContent('Rename a snapshot › AB-2 tight bass');
    await userEvent.keyboard('{Enter}');
    await expect(ran(canvasElement)).toBe('Rename AB-2 tight bass');
  },
};

export const ListsThePagesOwnCommandsFirst: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const first = (await body(canvasElement).findAllByRole('group'))[0];
    // Registered after Go to and Calls, yet on top: this page is the Snapshots one
    await expect(first).toHaveAccessibleName('Snapshots');
    await expect(within(first).getByRole('option', { name: /Rename a snapshot/ })).toBeVisible();
  },
};

export const OpensAMenuWithRightAndGoesBackWithLeft: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const search = await body(canvasElement).findByRole('combobox');
    await userEvent.type(search, 'rename');
    await userEvent.keyboard('{ArrowRight}');
    await expect(await body(canvasElement).findByRole('option', { name: 'AB-1 balanced' })).toBeVisible();
    // The caret is at the start of an empty search: Left steps back out
    await userEvent.keyboard('{ArrowLeft}');
    await expect(await body(canvasElement).findByRole('option', { name: /Rename a snapshot/ })).toBeVisible();
  },
};

export const LeavesTheArrowsToTheCaretMidSearch: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Control>}k{/Control}');
    const search = await body(canvasElement).findByRole('combobox');
    await userEvent.type(search, 'rename');
    // Caret moved off the end: Right just moves it, the menu stays closed
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}{ArrowLeft}');
    await expect(body(canvasElement).queryByRole('option', { name: 'AB-1 balanced' })).toBeNull();
    await userEvent.keyboard('{End}{ArrowRight}');
    await expect(await body(canvasElement).findByRole('option', { name: 'AB-1 balanced' })).toBeVisible();
  },
};
