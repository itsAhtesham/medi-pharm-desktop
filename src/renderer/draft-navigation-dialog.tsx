import React, { useEffect, useRef } from 'react';

export function DraftNavigationDialog({
  destination,
  disabled,
  onContinue,
  onDiscard,
}: {
  destination: string;
  disabled: boolean;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="draft-navigation-dialog"
      aria-labelledby="draft-navigation-title"
      aria-describedby="draft-navigation-description"
      onCancel={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      <h2 id="draft-navigation-title">Discard unsaved draft?</h2>
      <p id="draft-navigation-description">
        You have an unsaved draft. Discard it and open {destination}, or continue editing? Any
        unfinished purchase containing this form will also be discarded.
      </p>
      <div className="business-actions">
        <button type="button" className="secondary" autoFocus onClick={onContinue}>
          Continue editing
        </button>
        <button type="button" className="danger-button" disabled={disabled} onClick={onDiscard}>
          Discard and switch
        </button>
      </div>
    </dialog>
  );
}
