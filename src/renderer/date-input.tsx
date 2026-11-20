import React from 'react';

/** Keep the native calendar and keyboard entry, with the whole field as its click target. */
export function DateInput({
  onClick,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      {...props}
      type="date"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.currentTarget.disabled || event.currentTarget.readOnly)
          return;
        try {
          event.currentTarget.showPicker();
          // The icon's default action must not open the picker a second time.
          event.preventDefault();
        } catch {
          // Retain native icon/keyboard behavior if the picker is unavailable in this context.
        }
      }}
    />
  );
}
