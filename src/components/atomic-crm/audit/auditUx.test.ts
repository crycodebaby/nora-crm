/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { canAccess } from "../providers/commons/canAccess";
import {
  formatAuditEventLabel,
  formatAuditFieldValue,
  parseAuditChanges,
} from "./auditFormatters";
import type { AuditEvent } from "./auditTypes";

describe("parseAuditChanges", () => {
  it("reads compact changes from metadata.changes", () => {
    const event: AuditEvent = {
      id: "1",
      created_at: "2026-01-01T00:00:00Z",
      event_type: "deal.updated",
      entity_type: "deal",
      metadata: {
        changes: {
          stage: { old: "neue-anfrage", new: "angebot-gesendet" },
        },
      },
    };

    expect(parseAuditChanges(event)).toEqual({
      stage: { old: "neue-anfrage", new: "angebot-gesendet" },
    });
  });

  it("falls back to legacy old_data/new_data diff", () => {
    const event: AuditEvent = {
      id: "2",
      created_at: "2026-01-01T00:00:00Z",
      event_type: "company.updated",
      entity_type: "company",
      old_data: { name: "Alt GmbH", phone_number: "+49111" },
      new_data: { name: "Neu GmbH", phone_number: "+49111" },
    };

    expect(parseAuditChanges(event)).toEqual({
      name: { old: "Alt GmbH", new: "Neu GmbH" },
    });
  });

  it("treats note content meta as changes", () => {
    const event: AuditEvent = {
      id: "3",
      created_at: "2026-01-01T00:00:00Z",
      event_type: "deal_note.updated",
      entity_type: "deal_note",
      metadata: {
        old_preview: "Alt",
        new_preview: "Neu",
        content_changed: true,
      },
    };

    const changes = parseAuditChanges(event);
    expect(changes.old_preview).toEqual({ old: null, new: "Alt" });
    expect(changes.new_preview).toEqual({ old: null, new: "Neu" });
  });
});

describe("formatAuditFieldValue", () => {
  const dealStages = [{ value: "neue-anfrage", label: "Neue Anfrage" }];

  it("formats amounts as EUR de-DE", () => {
    expect(
      formatAuditFieldValue("amount", 4200, { currency: "EUR" }),
    ).toContain("4.200");
  });

  it("maps stage values via dealUtils labels", () => {
    expect(formatAuditFieldValue("stage", "opportunity", { dealStages })).toBe(
      "Neue Anfrage",
    );
  });

  it("formats ISO date-only strings in German long form", () => {
    const formatted = formatAuditFieldValue(
      "expected_closing_date",
      "2026-08-01",
      {},
    );
    expect(formatted).toContain("2026");
    expect(formatted).toContain("August");
  });
  it("maps legacy deal.stage_changed like deal.status_changed", () => {
    const legacy = formatAuditEventLabel("deal.stage_changed", {
      translateEvent: (type) =>
        type === "deal.stage_changed" ? "Vorgangsstatus geändert" : type,
    });
    expect(legacy).toBe("Vorgangsstatus geändert");
  });
});

describe("canAccess audit_events", () => {
  it("grants admin full audit access", () => {
    expect(
      canAccess("admin", { resource: "audit_events", action: "list" }),
    ).toBe(true);
    expect(
      canAccess("admin", { resource: "audit_events", action: "show" }),
    ).toBe(true);
  });

  it("allows office read/show but not global list", () => {
    expect(
      canAccess("office", { resource: "audit_events", action: "show" }),
    ).toBe(true);
    expect(
      canAccess("office", { resource: "audit_events", action: "read" }),
    ).toBe(true);
    expect(
      canAccess("office", { resource: "audit_events", action: "list" }),
    ).toBe(false);
  });

  it("denies viewer all audit access", () => {
    expect(
      canAccess("viewer", { resource: "audit_events", action: "show" }),
    ).toBe(false);
    expect(
      canAccess("viewer", { resource: "audit_events", action: "list" }),
    ).toBe(false);
  });
});
