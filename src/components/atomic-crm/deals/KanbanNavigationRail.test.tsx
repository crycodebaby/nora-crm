import { useCallback, useState } from "react";
import { I18nContextProvider, mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import "@/index.css";
import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import { KanbanNavigationRail } from "./KanbanNavigationRail";

const catalog = mergeTranslations(englishMessages, germanCrmMessages);
const i18nProvider = polyglotI18nProvider(() => catalog, "de", [
  { locale: "de", name: "Deutsch" },
]);

const STAGES = ["Neue Anfrage", "Kontaktiert", "Termin", "Aufmaß"];

const RailHarness = ({
  onCardPointerDown,
}: {
  onCardPointerDown?: () => void;
}) => {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  const scrollBy = useCallback(
    (distance: number) => {
      if (scrollElement) {
        scrollElement.scrollLeft += distance;
      }
    },
    [scrollElement],
  );

  const scrollToEdge = useCallback(
    (edge: "start" | "end") => {
      if (scrollElement) {
        scrollElement.scrollLeft =
          edge === "start" ? 0 : scrollElement.scrollWidth;
      }
    },
    [scrollElement],
  );

  return (
    <I18nContextProvider value={i18nProvider}>
      <div style={{ width: "min(1000px, 100%)" }}>
        <div
          id="nora-deals-kanban"
          ref={setScrollElement}
          className="nora-kanban-scroll"
          data-testid="rail-test-scroller"
          style={{ width: 400, overflowX: "auto" }}
        >
          <div className="nora-kanban-board" data-testid="rail-test-board">
            {STAGES.map((stage, index) => (
              <div className="nora-kanban-column" key={stage}>
                <h3 className="nora-kanban-column-title">{stage}</h3>
                {index === 0 ? (
                  <button
                    type="button"
                    data-rfd-draggable-id="deal-1"
                    onPointerDown={onCardPointerDown}
                  >
                    Vorgang
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <KanbanNavigationRail
          scrollElement={scrollElement}
          onScrollByColumn={(direction) => scrollBy(direction * 340)}
          onScrollByViewport={(direction) => scrollBy(direction * 320)}
          onScrollToEdge={scrollToEdge}
        />
      </div>
    </I18nContextProvider>
  );
};

describe("KanbanNavigationRail", () => {
  beforeEach(() => {
    page.viewport(1200, 800);
  });

  it("uses one native scrollLeft for thumb size, position and edge controls", async () => {
    const screen = await render(<RailHarness />);
    const rail = screen.getByTestId("nora-kanban-navigation-rail");
    const scroller = screen.getByTestId("rail-test-scroller");
    const track = screen.getByTestId("nora-kanban-rail-track");
    const thumb = screen.getByRole("scrollbar", {
      name: "Sichtbaren Bereich der Vorgänge verschieben",
    });

    await expect.element(rail).toHaveAttribute("data-visible", "true");
    await expect
      .element(screen.getByTestId("nora-kanban-rail-left"))
      .toBeDisabled();
    await expect
      .element(screen.getByTestId("nora-kanban-rail-right"))
      .toBeEnabled();

    const scrollerElement = scroller.element() as HTMLDivElement;
    const trackElement = track.element() as HTMLElement;
    const thumbElement = thumb.element() as HTMLElement;
    await vi.waitFor(() => {
      const expectedThumbWidth =
        trackElement.getBoundingClientRect().width *
        (scrollerElement.clientWidth / scrollerElement.scrollWidth);
      expect(
        Math.abs(
          thumbElement.getBoundingClientRect().width - expectedThumbWidth,
        ),
      ).toBeLessThan(1);
    });
    expect(thumbElement.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
    );
    expect(getComputedStyle(scrollerElement).scrollbarWidth).toBe("none");

    await screen.getByTestId("nora-kanban-rail-right").click();
    await vi.waitFor(() => expect(scrollerElement.scrollLeft).toBe(340));
    await screen.getByTestId("nora-kanban-rail-left").click();
    await vi.waitFor(() => expect(scrollerElement.scrollLeft).toBe(0));

    scrollerElement.scrollLeft = 500;
    await vi.waitFor(() => {
      expect(thumbElement.getAttribute("aria-valuenow")).toBe("500");
    });
    await expect
      .element(screen.getByTestId("nora-kanban-rail-left"))
      .toBeEnabled();
  });

  it("drags the thumb proportionally and clears pointer capture on release", async () => {
    const screen = await render(<RailHarness />);
    const rail = screen.getByTestId("nora-kanban-navigation-rail");
    const scroller = screen.getByTestId("rail-test-scroller");
    const thumb = screen.getByTestId("nora-kanban-rail-thumb");
    await expect.element(rail).toHaveAttribute("data-visible", "true");

    const scrollerElement = scroller.element() as HTMLDivElement;
    const thumbElement = thumb.element() as HTMLElement;
    let capturedPointer: number | null = null;
    thumbElement.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId;
    };
    thumbElement.hasPointerCapture = (pointerId) =>
      capturedPointer === pointerId;
    thumbElement.releasePointerCapture = (pointerId) => {
      if (capturedPointer === pointerId) capturedPointer = null;
    };

    thumbElement.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
    await expect.element(rail).toHaveAttribute("data-dragging", "true");

    thumbElement.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 180,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
    expect(scrollerElement.scrollLeft).toBeGreaterThan(0);

    thumbElement.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 180,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
    await expect.element(rail).toHaveAttribute("data-dragging", "false");
    expect(capturedPointer).toBeNull();
  });

  it("cleans up a cancelled drag and a lost pointer capture", async () => {
    const screen = await render(<RailHarness />);
    const rail = screen.getByTestId("nora-kanban-navigation-rail");
    const thumbElement = screen
      .getByTestId("nora-kanban-rail-thumb")
      .element() as HTMLElement;
    await expect.element(rail).toHaveAttribute("data-visible", "true");

    let capturedPointer: number | null = null;
    thumbElement.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId;
    };
    thumbElement.hasPointerCapture = (pointerId) =>
      capturedPointer === pointerId;
    thumbElement.releasePointerCapture = () => {
      capturedPointer = null;
    };

    const start = (pointerId: number) =>
      thumbElement.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId,
          pointerType: "mouse",
        }),
      );

    start(8);
    thumbElement.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: 8,
        pointerType: "mouse",
      }),
    );
    await expect.element(rail).toHaveAttribute("data-dragging", "false");

    start(9);
    thumbElement.dispatchEvent(
      new PointerEvent("lostpointercapture", {
        bubbles: true,
        pointerId: 9,
        pointerType: "mouse",
      }),
    );
    await expect.element(rail).toHaveAttribute("data-dragging", "false");
    expect(capturedPointer).toBeNull();

    start(10);
    await expect.element(rail).toHaveAttribute("data-dragging", "true");
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await expect.element(rail).toHaveAttribute("data-dragging", "false");
    expect(capturedPointer).toBeNull();
  });

  it("maps a track click to the native scroller and supports full keyboard navigation", async () => {
    const screen = await render(<RailHarness />);
    const scrollerElement = screen
      .getByTestId("rail-test-scroller")
      .element() as HTMLDivElement;
    const trackElement = screen
      .getByTestId("nora-kanban-rail-track")
      .element() as HTMLElement;
    const thumb = screen.getByTestId("nora-kanban-rail-thumb");
    await expect
      .element(screen.getByTestId("nora-kanban-navigation-rail"))
      .toHaveAttribute("data-visible", "true");

    const trackRect = trackElement.getBoundingClientRect();
    trackElement.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: trackRect.left + trackRect.width * 0.75,
      }),
    );
    await vi.waitFor(() => {
      expect(scrollerElement.scrollLeft).toBeGreaterThan(0);
    });

    const thumbElement = thumb.element() as HTMLElement;
    const pressThumbKey = (key: string) =>
      thumbElement.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      );
    expect(thumbElement.tabIndex).toBe(0);

    pressThumbKey("End");
    await vi.waitFor(() => {
      expect(scrollerElement.scrollLeft).toBe(
        scrollerElement.scrollWidth - scrollerElement.clientWidth,
      );
    });
    pressThumbKey("Home");
    await vi.waitFor(() => expect(scrollerElement.scrollLeft).toBe(0));
    pressThumbKey("ArrowRight");
    await vi.waitFor(() => expect(scrollerElement.scrollLeft).toBe(340));
    pressThumbKey("PageDown");
    await vi.waitFor(() => expect(scrollerElement.scrollLeft).toBe(660));
  });

  it("recalculates after resize and content mutation, including real column markers", async () => {
    const screen = await render(<RailHarness />);
    const scrollerElement = screen
      .getByTestId("rail-test-scroller")
      .element() as HTMLDivElement;
    const boardElement = screen
      .getByTestId("rail-test-board")
      .element() as HTMLDivElement;
    const thumbElement = screen
      .getByTestId("nora-kanban-rail-thumb")
      .element() as HTMLElement;
    await expect
      .element(screen.getByTestId("nora-kanban-navigation-rail"))
      .toHaveAttribute("data-visible", "true");

    expect(document.querySelectorAll(".nora-kanban-rail-marker")).toHaveLength(
      4,
    );
    const initialThumbWidth = thumbElement.getBoundingClientRect().width;
    scrollerElement.style.width = "600px";
    await vi.waitFor(() => {
      expect(thumbElement.getBoundingClientRect().width).toBeGreaterThan(
        initialThumbWidth,
      );
    });

    const extraColumn = document.createElement("div");
    extraColumn.className = "nora-kanban-column";
    extraColumn.innerHTML =
      '<h3 class="nora-kanban-column-title">Abgeschlossen</h3>';
    boardElement.append(extraColumn);
    await vi.waitFor(() => {
      expect(
        document.querySelectorAll(".nora-kanban-rail-marker"),
      ).toHaveLength(5);
    });

    await screen.unmount();
    expect(() => {
      scrollerElement.dispatchEvent(new Event("scroll"));
      boardElement.append(document.createElement("div"));
    }).not.toThrow();
  });

  it("keeps rail interactions outside card DnD and board-pan surfaces", async () => {
    const cardPointerDown = vi.fn();
    const screen = await render(
      <RailHarness onCardPointerDown={cardPointerDown} />,
    );
    const rail = screen
      .getByTestId("nora-kanban-navigation-rail")
      .element() as HTMLElement;
    const scroller = screen
      .getByTestId("rail-test-scroller")
      .element() as HTMLElement;
    await expect
      .element(screen.getByTestId("nora-kanban-navigation-rail"))
      .toHaveAttribute("data-visible", "true");

    expect(scroller.contains(rail)).toBe(false);
    expect(rail.closest("[data-kanban-pan-surface]")).toBeNull();
    expect(rail.querySelector("[data-rfd-draggable-id]")).toBeNull();
    await screen.getByTestId("nora-kanban-rail-right").click();
    expect(cardPointerDown).not.toHaveBeenCalled();
  });

  it("keeps every rail control grabbable and draggable with touch input", async () => {
    page.viewport(390, 844);
    const screen = await render(<RailHarness />);
    const scrollerElement = screen
      .getByTestId("rail-test-scroller")
      .element() as HTMLDivElement;
    const thumbElement = screen
      .getByTestId("nora-kanban-rail-thumb")
      .element() as HTMLElement;
    const trackElement = screen
      .getByTestId("nora-kanban-rail-track")
      .element() as HTMLElement;
    const leftButton = screen
      .getByTestId("nora-kanban-rail-left")
      .element() as HTMLElement;
    const rightButton = screen
      .getByTestId("nora-kanban-rail-right")
      .element() as HTMLElement;

    await expect
      .element(screen.getByTestId("nora-kanban-navigation-rail"))
      .toHaveAttribute("data-visible", "true");
    await vi.waitFor(() => {
      expect(thumbElement.getBoundingClientRect().width).toBeGreaterThanOrEqual(
        44,
      );
    });

    for (const control of [
      thumbElement,
      trackElement,
      leftButton,
      rightButton,
    ]) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(getComputedStyle(thumbElement).touchAction).toBe("none");
    expect(["manipulation", "pan-x pan-y pinch-zoom"]).toContain(
      getComputedStyle(scrollerElement).touchAction,
    );

    let capturedPointer: number | null = null;
    thumbElement.setPointerCapture = (pointerId) => {
      capturedPointer = pointerId;
    };
    thumbElement.hasPointerCapture = (pointerId) =>
      capturedPointer === pointerId;
    thumbElement.releasePointerCapture = () => {
      capturedPointer = null;
    };

    thumbElement.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 80,
        pointerId: 21,
        pointerType: "touch",
      }),
    );
    thumbElement.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 130,
        pointerId: 21,
        pointerType: "touch",
      }),
    );
    expect(scrollerElement.scrollLeft).toBeGreaterThan(0);
    thumbElement.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 130,
        pointerId: 21,
        pointerType: "touch",
      }),
    );
    await expect
      .element(screen.getByTestId("nora-kanban-navigation-rail"))
      .toHaveAttribute("data-dragging", "false");
    expect(capturedPointer).toBeNull();
  });
});
