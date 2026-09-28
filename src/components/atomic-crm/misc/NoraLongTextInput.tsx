import { useCallback, useEffect, useRef } from "react";
import { useWatch } from "react-hook-form";

import { TextInput, type TextInputProps } from "@/components/admin/text-input";

import { cn } from "@/lib/utils";

const grow = (el: HTMLTextAreaElement) => {
  // Let CSS max-height cap the growth; scrollHeight then scrolls inside.
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
};

/**
 * Multiline text input for long operational content.
 *
 * Starts at a useful height, grows with what the user types or pastes and
 * stops at the CSS cap (`.nora-textarea-grow`), where it scrolls internally.
 * Keyboard behaviour is the native textarea's; nothing is intercepted.
 */
export const NoraLongTextInput = ({
  className,
  inputClassName,
  rows = 5,
  ...props
}: TextInputProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const value = useWatch({ name: props.source });

  const findTextarea = useCallback(
    () => wrapperRef.current?.querySelector("textarea") ?? null,
    [],
  );

  // Programmatic value changes (record load, reset) do not fire `input`.
  useEffect(() => {
    const el = findTextarea();
    if (el) grow(el);
  }, [findTextarea, value]);

  return (
    <div ref={wrapperRef} className="min-w-0">
      <TextInput
        {...props}
        multiline
        rows={rows}
        className={cn("m-0", className)}
        inputClassName={cn("nora-textarea-grow", inputClassName)}
        onInput={(
          event: React.FormEvent<HTMLTextAreaElement | HTMLInputElement>,
        ) => {
          const target = event.currentTarget;
          if (target instanceof HTMLTextAreaElement) grow(target);
          (
            props.onInput as
              | ((
                  e: React.FormEvent<HTMLTextAreaElement | HTMLInputElement>,
                ) => void)
              | undefined
          )?.(event);
        }}
      />
    </div>
  );
};
