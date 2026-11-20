import React from 'react';

export function BackButton({
  destination,
  onClick,
  disabled = false,
}: {
  destination: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="text-button back-button" disabled={disabled} onClick={onClick}>
      <span aria-hidden="true">← </span>Back to {destination}
    </button>
  );
}
