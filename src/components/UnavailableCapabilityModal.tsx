import React, { useEffect, useRef } from 'react';

export interface UnavailableCapabilityModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  onClose: () => void;
}

const UnavailableCapabilityModal: React.FC<UnavailableCapabilityModalProps> = ({
  isOpen,
  title,
  description,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unavailable-capability-title"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        data-testid="unavailable-capability-modal"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              SendFIL
            </p>
            <h2
              id="unavailable-capability-title"
              className="mt-2 text-xl font-semibold text-slate-950"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-2xl leading-none text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
            aria-label="Close capability notice"
          >
            x
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#1f69ff] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1857d4]"
          >
            Keep default
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnavailableCapabilityModal;
