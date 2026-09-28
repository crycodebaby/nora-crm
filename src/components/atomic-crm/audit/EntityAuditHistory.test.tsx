import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import "@/index.css";
import { StoryWrapper } from "@/test/StoryWrapper";
import type { AuditEvent } from "./auditTypes";
import { EntityAuditHistory } from "./EntityAuditHistory";

const EVENTS: AuditEvent[] = [
  {
    id: "evt-1",
    created_at: "2026-09-02T10:00:00.000Z",
    event_type: "deal.updated",
    entity_type: "deal",
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "user",
    deal_id: 7,
    metadata: { changes: { name: { old: "Alt", new: "Neu" } } },
  },
  {
    id: "evt-2",
    created_at: "2026-09-01T10:00:00.000Z",
    event_type: "deal.created",
    entity_type: "deal",
    actor_name_snapshot: "Anna Admin",
    actor_role_snapshot: "admin",
    source: "user",
    deal_id: 7,
    metadata: {},
  },
];

const trigger = () =>
  page.getByRole("button", { name: /Change history|Änderungsverlauf/ });

const setup = async () => {
  const getEntityAuditEvents = vi.fn(async () => ({
    data: EVENTS,
    limit: 20,
  }));
  await render(
    <StoryWrapper dataProvider={{ getEntityAuditEvents }}>
      <EntityAuditHistory entityType="deal" entityId={7} />
    </StoryWrapper>,
  );
  await expect.element(trigger()).toBeVisible();
  return getEntityAuditEvents;
};

describe("EntityAuditHistory (Alpha UI 1)", () => {
  it("is collapsed by default and does not fetch until opened", async () => {
    const getEntityAuditEvents = await setup();

    await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(getEntityAuditEvents).not.toHaveBeenCalled();
    await expect
      .element(page.getByText(/Deal updated|Vorgang (aktualisiert|geändert)/))
      .not.toBeInTheDocument();
  });

  it("opens with one deliberate interaction, shows the entries and the loaded count", async () => {
    const getEntityAuditEvents = await setup();

    await userEvent.click(trigger());

    await expect.element(trigger()).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(page.getByText(/Deal updated|Vorgang (aktualisiert|geändert)/))
      .toBeVisible();
    await expect
      .element(page.getByText(/Deal created|Vorgang angelegt/))
      .toBeVisible();
    await expect.element(page.getByText(/2 entries/)).toBeVisible();
    expect(getEntityAuditEvents).toHaveBeenCalledTimes(1);

    // the region is wired to its control
    const button = document.querySelector(
      ".nora-expandable-trigger",
    ) as HTMLButtonElement;
    const bodyId = button.getAttribute("aria-controls");
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)).not.toBeNull();
  });

  it("keeps individual change expansion available inside an event", async () => {
    await setup();
    await userEvent.click(trigger());

    const changes = page.getByRole("button", { name: /Show 1 change$/ });
    await expect.element(changes).toBeVisible();
    await userEvent.click(changes);
    await expect.element(page.getByText("Neu")).toBeVisible();
  });

  it("collapses again without refetching and reopens from cache", async () => {
    const getEntityAuditEvents = await setup();

    await userEvent.click(trigger());
    await expect
      .element(page.getByText(/Deal updated|Vorgang (aktualisiert|geändert)/))
      .toBeVisible();

    await userEvent.click(trigger());
    await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");
    // loaded once, the body stays mounted but hidden — no refetch on reopen
    await expect
      .element(page.getByText(/Deal updated|Vorgang (aktualisiert|geändert)/))
      .not.toBeVisible();

    await userEvent.click(trigger());
    await expect
      .element(page.getByText(/Deal updated|Vorgang (aktualisiert|geändert)/))
      .toBeVisible();
    expect(getEntityAuditEvents).toHaveBeenCalledTimes(1);
  });
});
