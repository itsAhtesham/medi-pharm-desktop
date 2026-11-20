import React, { useEffect, useRef, useId } from 'react';

export function DraftNavigationDialog({
  destination,
  disabled,
  onContinue,
  onDiscard,
  discardParent = true,
  discardLabel = 'Discard and switch',
}: {
  destination: string;
  disabled: boolean;
  onContinue: () => void;
  onDiscard: () => void;
  discardParent?: boolean;
  discardLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="draft-navigation-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      <h2 id={titleId}>Discard unsaved draft?</h2>
      <p id={descriptionId}>
        You have an unsaved draft. Discard it and open {destination}, or continue editing?
        {discardParent && ' Any unfinished purchase containing this form will also be discarded.'}
      </p>
      <div className="business-actions">
        <button type="button" className="secondary" autoFocus onClick={onContinue}>
          Continue editing
        </button>
        <button type="button" className="danger-button" disabled={disabled} onClick={onDiscard}>
          {discardLabel}
        </button>
      </div>
    </dialog>
  );
}
