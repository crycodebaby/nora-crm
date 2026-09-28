import { useEffect, useId, useRef, useState } from "react";
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
 * Long operational text (descriptions, pasted mails) on a show surface.
 *
 * Readable measure, real newlines, and progressive disclosure that only
 * appears when the text actually overflows the collapsed height. Collapsed
 * text still shows its first paragraphs; the toggle is a real button with
 * `aria-expanded` and never the only way to reach the content on paper —
 * expanding is one click, printing is unaffected.
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
        data-collapsed={collapsed ? "true" : "false"}
        style={
          {
            "--nora-longtext-collapsed": `${collapsedHeight}px`,
          } as React.CSSProperties
        }
      >
        {text}
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
            : translate("crm.longtext.show_more", {
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
