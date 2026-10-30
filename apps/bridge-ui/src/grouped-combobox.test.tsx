import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupedCombobox } from './Combobox.js';

describe('the grouped combo box', () => {
  it('names the current choices on its closed trigger, as a select-like listbox button', () => {
    const html = renderToStaticMarkup(
      <GroupedCombobox
        label="View, filters and actions"
        triggerLabel="Calls · Errors"
        groups={[
          { label: 'View', items: [{ key: 'calls', label: 'Calls', selected: true, onPick: vi.fn() }] },
          { label: 'Actions', items: [] },
        ]}
      />,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="View, filters and actions: Calls · Errors"');
    expect(html).toContain('>Calls · Errors<');
    expect(html).not.toContain('role="listbox"'); // closed until opened
  });
});
