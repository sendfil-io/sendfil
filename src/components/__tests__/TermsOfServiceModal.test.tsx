import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import TermsOfServiceModal from '../TermsOfServiceModal';
import { TERMS_LAST_UPDATED } from '../../legal/termsAcceptance';

function TermsModalHarness({ onClose }: { onClose: () => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open Terms
      </button>
      <TermsOfServiceModal
        isOpen={isOpen}
        onClose={() => {
          onClose();
          setIsOpen(false);
        }}
      />
    </>
  );
}

function NestedTermsModalHarness({ onClose }: { onClose: () => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div role="dialog" aria-modal="true" data-testid="wallet-chooser">
      <button type="button" onClick={() => setIsOpen(true)}>
        Read Terms
      </button>
      <TermsOfServiceModal
        isOpen={isOpen}
        onClose={() => {
          onClose();
          setIsOpen(false);
        }}
      />
    </div>
  );
}

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button with label "${label}"`);
  }

  return button;
}

function click(element: HTMLElement) {
  act(() => {
    element.click();
  });
}

describe('TermsOfServiceModal', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://sendfil.io/',
    });

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('HTMLButtonElement', dom.window.HTMLButtonElement);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  it('renders an accessible dialog with the effective date and material SendFIL terms', () => {
    act(() => {
      root.render(<TermsOfServiceModal isOpen onClose={vi.fn()} />);
    });

    const dialog = document.querySelector('[role="dialog"]');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    const title = labelledBy ? document.getElementById(labelledBy) : null;

    expect(dialog).toBeInstanceOf(HTMLElement);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(title?.textContent).toBe('SendFIL Terms of Service');
    expect(dialog?.textContent).toContain(`Effective and last updated ${TERMS_LAST_UPDATED}`);
    expect(dialog?.textContent).toContain('SendFIL is a non-custodial interface');
    expect(dialog?.textContent).toContain('Connecting does not itself move FIL.');
    expect(dialog?.textContent).toContain('Multicall3');
    expect(dialog?.textContent).toContain('ThinBatch');
    expect(dialog?.textContent).toContain('16. Disclaimers');
    expect(dialog?.textContent).toContain('17. Limitation of liability');
    expect(dialog?.textContent).toContain('20. Contact');
    expect(
      dialog?.querySelector<HTMLAnchorElement>('a[href="mailto:sendfil@proton.me"]')?.textContent,
    ).toContain('sendfil@proton.me');
  });

  it('closes on Escape and restores focus to the element that opened it', () => {
    const onClose = vi.fn();

    act(() => {
      root.render(<TermsModalHarness onClose={onClose} />);
    });

    const trigger = getButton('Open Terms');
    trigger.focus();
    click(trigger);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'Escape',
        }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
  });

  it('hides and inerts an underlying modal while the Terms are open', () => {
    act(() => {
      root.render(<NestedTermsModalHarness onClose={vi.fn()} />);
    });

    const trigger = getButton('Read Terms');
    const underlyingDialog = document.querySelector(
      '[data-testid="wallet-chooser"]',
    ) as HTMLElement;
    trigger.focus();
    click(trigger);

    expect(underlyingDialog.getAttribute('aria-hidden')).toBe('true');
    expect(underlyingDialog.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('terms-modal-title');

    click(getButton('Close'));

    expect(underlyingDialog.hasAttribute('aria-hidden')).toBe(false);
    expect(underlyingDialog.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
