import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslate } from "ra-core";

import { cn } from "@/lib/utils";

type NoraLongTextProps = {
  text: string;
  /** Collapsed height in px; content shorter than this is never collapsed. */
  collapsedHeight?: number;
  className?: string;
};

/**
 * Splits stored text into visual paragraphs at blank lines. The characters
 * are rendered verbatim (single newlines stay line breaks via `pre-line`);
 * only the *spacing* between blocks is added. Nothing is rewritten.
 */
export const splitIntoBlocks = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim().length > 0);

/**
 * Long operational text (descriptions, pasted mails) on a show surface.
 *
 * Readable measure (68ch), German hyphenation, real newlines, blank-line
 * paragraph rhythm, and progressive disclosure that only appears when the
 * text actually overflows the collapsed height. The toggle names how much
 * is hidden (line count) so the reader can decide before clicking.
 */
export const NoraLongText = ({
  text,
  collapsedHeight = 248,
  className,
}: NoraLongTextProps) => {
  const translate = useTranslate();
  const ref = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const blocks = useMemo(() => splitIntoBlocks(text), [text]);
  const lineCount = useMemo(
    () => text.replace(/\r\n?/g, "\n").split("\n").length,
    [text],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setOverflows(node.scrollHeight > collapsedHeight + 8);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsedHeight, text]);

  const collapsed = overflows && !expanded;

  return (
    <div className={className}>
      <div
        ref={ref}
        id={bodyId}
        className={cn("nora-longtext")}
        lang="de"
        data-collapsed={collapsed ? "true" : "false"}
        style={
          {
            "--nora-longtext-collapsed": `${collapsedHeight}px`,
          } as React.CSSProperties
        }
      >
        {blocks.map((block, index) => (
          <p key={index} className="nora-longtext-block">
            {block}
          </p>
        ))}
      </div>
      {overflows ? (
        <button
          type="button"
          className="nora-longtext-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? translate("crm.longtext.show_less", { _: "Weniger anzeigen" })
            : translate("crm.longtext.show_more_lines", {
                smart_count: lineCount,
                _: "Ganzen Text anzeigen",
              })}
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
};
