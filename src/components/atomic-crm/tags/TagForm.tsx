import { Loader2, SaveIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useTranslate } from "ra-core";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { normalizeTagName } from "../application/commands/ensureTag";
import { normalizeCrmError } from "../misc/normalizeCrmError";
import type { Tag } from "../types";
import { colors } from "./colors";
import { RoundButton } from "./RoundButton";

type TagFormProps = {
  open: boolean;
  cancelLabel?: string;
  tag?: Pick<Tag, "name" | "color">;
  /**
   * Every Markierung that already exists, so the form can tell the user
   * BEFORE they press Speichern that this name is taken — the create dialog
   * then reuses it, the rename dialog refuses. Optional: callers that do not
   * pass it simply get no hint.
   */
  existingTags?: Tag[];
  /** Ignored when checking for a clash — the tag currently being renamed. */
  currentTagId?: Tag["id"];
  onCancel?(): void;
  onSubmit(tag: Pick<Tag, "name" | "color">): Promise<void>;
};

export function TagForm({
  open,
  cancelLabel,
  tag,
  existingTags,
  currentTagId,
  onCancel,
  onSubmit,
}: TagFormProps) {
  const translate = useTranslate();
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(colors[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /**
   * A ref, not the state above: two clicks in the SAME tick both run this
   * handler with the same render's `isSubmitting` (still false), so a
   * state-based guard would let the second one through. The ref flips
   * synchronously, which is what actually makes a double click impossible.
   */
  const submittingRef = useRef(false);

  const trimmedName = newTagName.trim();

  const clashingTag = useMemo(() => {
    if (!existingTags || trimmedName === "") return undefined;
    const key = normalizeTagName(trimmedName);
    return existingTags.find(
      (candidate) =>
        candidate.id !== currentTagId &&
        normalizeTagName(candidate.name) === key,
    );
  }, [existingTags, trimmedName, currentTagId]);

  const handleNewTagNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setNewTagName(event.target.value);
    setErrorKey(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Guards against the double submit at its source: while a request is in
    // flight this handler simply does nothing, so a second Enter or a second
    // click cannot start a second create.
    if (submittingRef.current || trimmedName === "") return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorKey(null);

    try {
      await onSubmit({ name: trimmedName, color: newTagColor });
    } catch (error) {
      // The dialog deliberately stays open and keeps what the user typed —
      // a mutation that failed must never look like one that succeeded.
      setErrorKey(normalizeCrmError(error).messageKey);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    setNewTagName(tag?.name ?? "");
    setNewTagColor(tag?.color ?? colors[0]);
    submittingRef.current = false;
    setIsSubmitting(false);
    setErrorKey(null);
  }, [open, tag]);

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="tag-name">
            {translate("resources.tags.dialog.name_label")}
          </Label>
          <Input
            id="tag-name"
            autoFocus
            value={newTagName}
            onChange={handleNewTagNameChange}
            disabled={isSubmitting}
            aria-describedby={
              errorKey
                ? "tag-form-error"
                : clashingTag
                  ? "tag-form-hint"
                  : undefined
            }
            placeholder={translate("resources.tags.dialog.name_placeholder")}
          />
          {clashingTag && !errorKey && (
            <p id="tag-form-hint" className="text-xs text-muted-foreground">
              {translate("resources.tags.dialog.exists_hint", {
                name: clashingTag.name,
              })}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{translate("resources.tags.dialog.color")}</Label>
          <div className="flex flex-wrap">
            {colors.map((color) => (
              <RoundButton
                key={color}
                color={color}
                selected={color === newTagColor}
                handleClick={() => {
                  setNewTagColor(color);
                }}
              />
            ))}
          </div>
        </div>

        {errorKey && (
          <p
            id="tag-form-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {translate(errorKey)}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel ?? translate("ra.action.cancel")}
          </Button>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={isSubmitting || trimmedName === ""}
          aria-busy={isSubmitting}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "text-primary",
            isSubmitting ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <SaveIcon />}
          {isSubmitting
            ? translate("resources.tags.dialog.saving")
            : translate("ra.action.save")}
        </Button>
      </div>
    </form>
  );
}
