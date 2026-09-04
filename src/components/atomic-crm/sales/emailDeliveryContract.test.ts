import {
  describeEmployeeMailKind,
  EMPLOYEE_MAIL_CORRELATION_CONFIDENCE,
  EMPLOYEE_MAIL_DELIVERY_HEADING,
  EMPLOYEE_MAIL_OUTCOME_ACTIONS,
  EMPLOYEE_MAIL_OUTCOME_LABELS,
  formatEmployeeMailDeliveryLine,
  formatEmployeeMailDeliveryTimestamp,
  impliesOnboardingCompleted,
  summariseEmployeeMailDelivery,
  type EmployeeMailDeliveryOutcome,
  type EmployeeMailDeliveryStatus,
  type EmployeeMailKind,
} from "./emailDeliveryContract";

const row = (
  over: Partial<EmployeeMailDeliveryStatus> = {},
): EmployeeMailDeliveryStatus => ({
  employeeId: 7,
  mailKind: "employee_invite",
  outcome: "delivered",
  lastEventAt: "2026-09-04T15:09:37.000Z",
  eventCount: 2,
  ...over,
});

const OUTCOMES: EmployeeMailDeliveryOutcome[] = [
  "accepted",
  "delayed",
  "delivered",
  "undeliverable",
  "spam_reported",
];

const MAIL_KINDS: EmployeeMailKind[] = [
  "employee_invite",
  "employee_password_setup",
  "unknown",
];

describe("summariseEmployeeMailDelivery", () => {
  it("reports nothing when there is no delivery history", () => {
    expect(summariseEmployeeMailDelivery([])).toBeNull();
  });

  it("picks the newest outcome across mail kinds", () => {
    const summary = summariseEmployeeMailDelivery([
      row({
        mailKind: "employee_invite",
        outcome: "delivered",
        lastEventAt: "2026-09-01T10:00:00.000Z",
      }),
      row({
        mailKind: "employee_password_setup",
        outcome: "undeliverable",
        lastEventAt: "2026-09-04T10:00:00.000Z",
      }),
    ]);
    expect(summary?.outcome).toBe("undeliverable");
    expect(summary?.mailKind).toBe("employee_password_setup");
  });

  it("does not depend on array order", () => {
    const older = row({
      outcome: "accepted",
      lastEventAt: "2026-09-01T10:00:00.000Z",
    });
    const newer = row({
      outcome: "delivered",
      lastEventAt: "2026-09-04T10:00:00.000Z",
    });
    expect(summariseEmployeeMailDelivery([older, newer])?.outcome).toBe(
      "delivered",
    );
    expect(summariseEmployeeMailDelivery([newer, older])?.outcome).toBe(
      "delivered",
    );
  });

  it("breaks an identical timestamp by severity, mirroring the read model", () => {
    const at = "2026-09-04T10:00:00.000Z";
    const summary = summariseEmployeeMailDelivery([
      row({
        mailKind: "employee_invite",
        outcome: "delivered",
        lastEventAt: at,
      }),
      row({
        mailKind: "employee_password_setup",
        outcome: "undeliverable",
        lastEventAt: at,
      }),
    ]);
    expect(summary?.outcome).toBe("undeliverable");
  });

  it("skips a row whose timestamp cannot be read rather than guessing", () => {
    const summary = summariseEmployeeMailDelivery([
      row({ outcome: "undeliverable", lastEventAt: "not-a-date" }),
      row({ outcome: "delivered", lastEventAt: "2026-09-04T10:00:00.000Z" }),
    ]);
    expect(summary?.outcome).toBe("delivered");
  });

  it("reports nothing when no row carries a usable timestamp", () => {
    expect(
      summariseEmployeeMailDelivery([row({ lastEventAt: "" })]),
    ).toBeNull();
  });

  it("keeps an unknown mail kind instead of dropping the outcome", () => {
    const summary = summariseEmployeeMailDelivery([
      row({ mailKind: "unknown", outcome: "delivered" }),
    ]);
    expect(summary?.mailKind).toBe("unknown");
    expect(summary?.outcome).toBe("delivered");
  });
});

describe("formatEmployeeMailDeliveryTimestamp", () => {
  it("renders date and time in the operating timezone of the business", () => {
    // 15:09 UTC is 17:09 in Europe/Berlin (CEST) — the time the administrator
    // sees in the mailbox and in the provider log.
    expect(
      formatEmployeeMailDeliveryTimestamp("2026-09-04T15:09:37.000Z"),
    ).toBe("04.09.2026 um 17:09");
  });

  it("returns nothing for an unusable value", () => {
    expect(formatEmployeeMailDeliveryTimestamp("not-a-date")).toBeNull();
  });
});

describe("formatEmployeeMailDeliveryLine", () => {
  it("dates a delivered mail", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "delivered",
      lastEventAt: "2026-09-04T15:09:37.000Z",
      mailKind: "unknown",
    });
    expect(line.text).toBe("Zugestellt am 04.09.2026 um 17:09");
    expect(line.action).toBeNull();
  });

  it("falls back to the undated label rather than inventing a time", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "delivered",
      lastEventAt: "not-a-date",
      mailKind: "employee_invite",
    });
    expect(line.text).toBe("E-Mail zugestellt");
  });

  it("says only that an accepted mail was sent", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "accepted",
      lastEventAt: "2026-09-04T15:09:36.000Z",
      mailKind: "unknown",
    });
    expect(line.text).toBe("E-Mail versendet");
    expect(line.text.toLowerCase()).not.toContain("zugestellt");
    expect(line.action).toBeNull();
  });

  it("reports a delayed delivery without alarming wording", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "delayed",
      lastEventAt: "2026-09-04T15:09:36.000Z",
      mailKind: "unknown",
    });
    expect(line.text).toBe("Zustellung verzögert");
    expect(line.action).toBe("Der Anbieter versucht es weiter zuzustellen.");
  });

  it("names the next step for an undeliverable mail", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "undeliverable",
      lastEventAt: "2026-09-04T15:09:36.000Z",
      mailKind: "employee_invite",
    });
    expect(line.text).toBe("E-Mail konnte nicht zugestellt werden");
    expect(line.action).toBe("E-Mail-Adresse prüfen");
  });

  it("states a spam report calmly and promises no automatic retry", () => {
    const line = formatEmployeeMailDeliveryLine({
      outcome: "spam_reported",
      lastEventAt: "2026-09-04T15:09:36.000Z",
      mailKind: "unknown",
    });
    expect(line.text).toBe("Als Spam markiert – Zustellung eingeschränkt");
    expect(line.action).toBe("Keine automatische erneute Zustellung");
  });

  it("renders the same wording whatever the mail kind is", () => {
    const texts = MAIL_KINDS.map(
      (mailKind) =>
        formatEmployeeMailDeliveryLine({
          outcome: "delivered",
          lastEventAt: "2026-09-04T15:09:37.000Z",
          mailKind,
        }).text,
    );
    expect(new Set(texts).size).toBe(1);
  });
});

describe("correlation honesty", () => {
  it("stays best effort, so no wording may claim one specific mail", () => {
    expect(EMPLOYEE_MAIL_CORRELATION_CONFIDENCE).toBe("best_effort");
  });

  it("keeps the heading impersonal", () => {
    expect(EMPLOYEE_MAIL_DELIVERY_HEADING).toBe("Letzte E-Mail-Zustellung");
    expect(EMPLOYEE_MAIL_DELIVERY_HEADING).not.toMatch(/einladung|passwort/i);
  });

  it("never turns a mail kind into rendered text", () => {
    for (const kind of MAIL_KINDS) {
      expect(describeEmployeeMailKind(kind)).toBeNull();
    }
  });

  it("never claims the employee opened, read or clicked anything", () => {
    const wording = [
      ...OUTCOMES.map((outcome) => EMPLOYEE_MAIL_OUTCOME_LABELS[outcome]),
      ...OUTCOMES.map(
        (outcome) => EMPLOYEE_MAIL_OUTCOME_ACTIONS[outcome] ?? "",
      ),
      EMPLOYEE_MAIL_DELIVERY_HEADING,
    ]
      .join(" ")
      .toLowerCase();

    for (const forbidden of [
      "geöffnet",
      "gelesen",
      "geklickt",
      "klick",
      "opened",
      "clicked",
      "onboarding abgeschlossen",
    ]) {
      expect(wording).not.toContain(forbidden);
    }
  });

  it("never lets a delivery outcome imply completed onboarding", () => {
    for (const outcome of OUTCOMES) {
      expect(impliesOnboardingCompleted(outcome)).toBe(false);
    }
  });
});
