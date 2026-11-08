/**
 * SchemaMapper component tests for WP 5.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SchemaMapper } from '../src/components/SchemaMapper';
import { losslessParse } from '../src/lib/lossless';

describe("SchemaMapper Tab order (D-007)", () => {
  // Tabbable elements in DOM order, the order Tab visits them when no tabindex is positive
  const TABBABLE = 'select, input, button, textarea, a[href], [tabindex]:not([tabindex="-1"])';

  function renderFlat() {
    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'flat', promptPath: 'prompt', responsePath: 'response' }}
        sampleRecords={[{ prompt: 'P', response: 'R' }]}
        onApply={() => {}}
      />
    );
    const dialog = screen.getByRole('dialog');
    return Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (el) => !el.hasAttribute('disabled')
    );
  }

  function nameOf(el: HTMLElement): string {
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent ?? '';
    }
    return el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  }

  it('visits the fields, then the footer buttons, then Close, with no positive tabindex', () => {
    const tabbable = renderFlat();
    expect(tabbable.map(nameOf)).toEqual(['Record type', 'Prompt field', 'Response field', 'Cancel', 'Apply', 'Close']);
    for (const el of tabbable) {
      expect(Number(el.getAttribute('tabindex') ?? 0)).toBeLessThanOrEqual(0);
    }
  });

  it('keeps Tab inside the dialog: Tab on the last element returns to the first, Shift+Tab on the first goes to the last', () => {
    const tabbable = renderFlat();
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab', code: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', code: 'Tab', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false });
    expect(document.activeElement).toBe(last);
  });
});

describe('SchemaMapper', () => {
  const sampleRecords = [
    { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }] },
    { messages: [{ role: 'user', content: 'How are you?' }, { role: 'assistant', content: 'Good' }] },
  ];

  it('renders with unknown format', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={sampleRecords}
        onApply={onApply}
      />
    );

    expect(screen.getByText('How to read this file')).toBeInTheDocument();
    expect(screen.getByLabelText('Record type')).toBeInTheDocument();
  });

  it('shows messages fields when messages shape selected', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={sampleRecords}
        onApply={onApply}
      />
    );

    // Select messages shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'messages' } });

    // Check messages-specific fields appear
    expect(screen.getByLabelText('Messages field')).toBeInTheDocument();
    expect(screen.getByLabelText('Role Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Content Key')).toBeInTheDocument();
  });

  it('validates path input and shows preview', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={[{ prompt: 'Hello', response: 'World' }]}
        onApply={onApply}
      />
    );

    // Select flat shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'flat' } });

    // Enter prompt path
    const promptInput = screen.getByLabelText('Prompt field');
    fireEvent.change(promptInput, { target: { value: 'prompt' } });

    // Enter response path
    const responseInput = screen.getByLabelText('Response field');
    fireEvent.change(responseInput, { target: { value: 'response' } });

    // Preview should show resolved values
    expect(screen.getByText(/Preview.*Hello/)).toBeInTheDocument();
    expect(screen.getByText(/Preview.*World/)).toBeInTheDocument();
  });

  it('applies format on Apply click', () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={onOpenChange}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={[{ prompt: 'Hello', response: 'World' }]}
        onApply={onApply}
      />
    );

    // Select flat shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'flat' } });

    // Enter paths
    const promptInput = screen.getByLabelText('Prompt field');
    fireEvent.change(promptInput, { target: { value: 'prompt' } });

    const responseInput = screen.getByLabelText('Response field');
    fireEvent.change(responseInput, { target: { value: 'response' } });

    // Click Apply
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);

    // Check onApply was called with correct format
    expect(onApply).toHaveBeenCalledWith({
      kind: 'flat',
      promptPath: 'prompt',
      responsePath: 'response',
    });

    // Check dialog was closed
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('preserves negative indices in path', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={[{ messages: [{ role: 'user', content: 'Hi' }] }]}
        onApply={onApply}
      />
    );

    // Select messages shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'messages' } });

    // Enter path with negative index
    const messagesInput = screen.getByLabelText('Messages field');
    fireEvent.change(messagesInput, { target: { value: 'messages' } });

    // Apply
    const applyButton = screen.getByText('Apply');
    fireEvent.click(applyButton);

    // Check path is preserved as-is (negative indices not normalized in format paths)
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'messages',
        path: 'messages',
      })
    );
  });

  it('shows role mapping for messages shape', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={sampleRecords}
        onApply={onApply}
      />
    );

    // Select messages shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'messages' } });

    // Check role mapping section appears
    expect(screen.getByText('Role Mappings')).toBeInTheDocument();

    // Should show detected roles (use selector to avoid matching dropdown options)
    expect(screen.getByText('user', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('assistant', { selector: 'span' })).toBeInTheDocument();
  });

  it('cancels on Cancel click', () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={onOpenChange}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={sampleRecords}
        onApply={onApply}
      />
    );

    // Click Cancel
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    // Check onApply was NOT called
    expect(onApply).not.toHaveBeenCalled();

    // Check dialog was closed
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables Apply when invalid path', () => {
    const onApply = vi.fn();

    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'unknown' }}
        sampleRecords={[{ prompt: 'Hello' }]}
        onApply={onApply}
      />
    );

    // Select flat shape
    const shapeSelect = screen.getByLabelText('Record type');
    fireEvent.change(shapeSelect, { target: { value: 'flat' } });

    // Leave paths empty
    const applyButton = screen.getByText('Apply');
    expect(applyButton).toBeDisabled();
  });
});

describe('SchemaMapper path preview', () => {
  it('previews a number, and an object holding one, with its digits as written (D-082)', () => {
    // Samples come from record(), which parses with lossless-json
    render(
      <SchemaMapper
        open={true}
        onOpenChange={() => {}}
        currentFormat={{ kind: 'flat', promptPath: 'a', responsePath: 'n' }}
        sampleRecords={[losslessParse('{"a":{"n":7},"n":9007199254740993}')]}
        onApply={() => {}}
      />
    );

    expect(screen.getAllByText(/^Preview:/).map((el) => el.textContent)).toEqual([
      'Preview: {"n":7}',
      'Preview: 9007199254740993',
    ]);
  });
});
