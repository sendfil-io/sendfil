import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TermsOfServiceContent } from '../legal/TermsOfServiceContent';

interface TermsOfServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TermsOfServiceModal({ isOpen, onClose }: TermsOfServiceModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.focus();

    const backgroundDialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
    )
      .filter((dialog) => dialog !== modalRef.current && !dialog.contains(modalRef.current))
      .map((dialog) => ({
        dialog,
        hadAriaHidden: dialog.hasAttribute('aria-hidden'),
        previousAriaHidden: dialog.getAttribute('aria-hidden'),
        hadInert: dialog.hasAttribute('inert'),
      }));

    backgroundDialogs.forEach(({ dialog }) => {
      dialog.setAttribute('aria-hidden', 'true');
      dialog.setAttribute('inert', '');
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusableElements = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || activeElement === modalRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;

      backgroundDialogs.forEach(
        ({ dialog, hadAriaHidden, previousAriaHidden, hadInert }) => {
          if (hadAriaHidden) {
            dialog.setAttribute('aria-hidden', previousAriaHidden ?? '');
          } else {
            dialog.removeAttribute('aria-hidden');
          }

          if (!hadInert) {
            dialog.removeAttribute('inert');
          }
        },
      );

      if (previouslyFocusedElement.current?.isConnected) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const content = (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/65 px-4 py-4 sm:py-8">
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-modal-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl sm:max-h-[calc(100vh-4rem)]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Legal</p>
            <h2 id="terms-modal-title" className="mt-1 text-xl font-semibold text-slate-950">
              SendFIL Terms of Service
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl leading-none text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
            aria-label="Close Terms of Service"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
          <TermsOfServiceContent />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
          <p className="hidden text-xs text-slate-500 sm:block">
            Keep a copy of the Terms that apply when you use SendFIL.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}
