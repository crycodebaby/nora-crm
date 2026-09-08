import { createDataProvider } from "./dataProvider";
import { buildCompany, buildContact, createCrmDb } from "@/test/StoryWrapper";
import { NORA_ERROR_CODES } from "../../domain/noraErrorCodes";
import {
  CONTACT_SAVE_INTENT_FIELD,
  type ContactSaveIntent,
} from "../../domain/contactPrimaryIntent";
import {
  getDefaultOperationManager,
  resetDefaultOperationManagerForTests,
} from "../../operations/operationManager";

/**
 * Atomic Contact Primary Intent (2026-09-08): FakeRest must implement the
 * SAME business contract as public.create_contact / public.update_contact —
 * max one primary, replacement with observed-holder verification, stale
 * refusal (NORA_PRIMARY_CONTACT_CHANGED), idempotent replay, customer moves,
 * and ONE application operation per save. Demo mode must never accept a
 * state Production rejects.
 */
describe("FakeRest — contact primary intent parity", () => {
  const getDetails = (error: unknown): unknown =>
    (error as { details?: unknown } | null)?.details;

  const intent = (
    primary: ContactSaveIntent["primary"],
    idempotencyKey?: string,
  ) => ({ [CONTACT_SAVE_INTENT_FIELD]: { primary, idempotencyKey } });

  const setup = () => {
    resetDefaultOperationManagerForTests();
    const k1 = buildCompany({ id: 20, name: "freddie krüger test" });
    const k2 = buildCompany({ id: 21, name: "Zweitkunde GmbH" });
    const freddie = buildContact({
      id: 29,
      first_name: "Freddie",
      last_name: "Krüger",
      company_id: 20,
      is_primary: true,
    });
    const hans = buildContact({
      id: 30,
      first_name: "Hans",
      last_name: "Hilfe",
      company_id: 20,
      is_primary: false,
    });
    const greta = buildContact({
      id: 31,
      first_name: "Greta",
      last_name: "Grün",
      company_id: 21,
      is_primary: true,
    });
    const dataProvider = createDataProvider({
      db: createCrmDb({
        companies: [k1, k2],
        contacts: [freddie, hans, greta],
      }),
      silent: true,
      latency: 0,
    });
    return { dataProvider, freddie, hans, greta };
  };

  const primariesOf = async (
    dataProvider: ReturnType<typeof createDataProvider>,
    companyId: number,
  ) => {
    const { data } = await dataProvider.getList("contacts", {
      filter: { company_id: companyId },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    return data.filter((c: any) => c.is_primary === true).map((c: any) => c.id);
  };

  it("incident regression: create Träumchen as Hauptansprechpartner replaces Freddie in ONE operation", async () => {
    const { dataProvider } = setup();
    const { data } = await dataProvider.create("contacts", {
      data: {
        first_name: "Träumchen",
        last_name: "Test",
        company_id: 20,
        is_primary: true,
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: 29,
        }),
      },
    });
    expect(data.is_primary).toBe(true);
    expect(await primariesOf(dataProvider, 20)).toEqual([data.id]);
    const ops = getDefaultOperationManager().getOperations();
    expect(ops.map((o) => o.operationType)).toEqual(["contact.create"]);
    expect(ops[0].status).toBe("success");
  });

  it("stale holder: expected Freddie but Träumchen holds the slot → NORA_PRIMARY_CONTACT_CHANGED, nothing written", async () => {
    const { dataProvider } = setup();
    await dataProvider.create("contacts", {
      data: {
        first_name: "Träumchen",
        last_name: "Test",
        company_id: 20,
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: 29,
        }),
      },
    });
    const before = (
      await dataProvider.getList("contacts", {
        filter: { company_id: 20 },
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      })
    ).total;

    let caught: unknown;
    try {
      await dataProvider.create("contacts", {
        data: {
          first_name: "Stale",
          last_name: "Versuch",
          company_id: 20,
          ...intent({
            kind: "make_primary",
            expectedCurrentPrimaryContactId: 29,
          }),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED);
    const after = (
      await dataProvider.getList("contacts", {
        filter: { company_id: 20 },
        pagination: { page: 1, perPage: 100 },
        sort: { field: "id", order: "ASC" },
      })
    ).total;
    expect(after).toBe(before);
    expect((await primariesOf(dataProvider, 20)).length).toBe(1);
  });

  it("expected null on a customer that HAS a primary is refused; on an empty customer it succeeds", async () => {
    const { dataProvider } = setup();
    let caught: unknown;
    try {
      await dataProvider.create("contacts", {
        data: {
          first_name: "Null",
          last_name: "Erwartung",
          company_id: 20,
          ...intent({
            kind: "make_primary",
            expectedCurrentPrimaryContactId: null,
          }),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED);

    const { data: k3 } = await dataProvider.create("companies", {
      data: buildCompany({ id: 22, name: "Leerkunde AG", nb_contacts: 0 }),
    });
    const { data } = await dataProvider.create("contacts", {
      data: {
        first_name: "Erste",
        last_name: "Person",
        company_id: k3.id,
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: null,
        }),
      },
    });
    expect(data.is_primary).toBe(true);
  });

  it("ordinary create (keep) ignores a raw is_primary=true in the payload", async () => {
    const { dataProvider } = setup();
    const { data } = await dataProvider.create("contacts", {
      data: {
        first_name: "Olga",
        last_name: "Ordinär",
        company_id: 20,
        is_primary: true,
        ...intent({ kind: "keep" }),
      },
    });
    expect(data.is_primary).toBe(false);
    expect(await primariesOf(dataProvider, 20)).toEqual([29]);
  });

  it("legacy raw is_primary=true without intent never silently replaces (refused when a primary exists)", async () => {
    const { dataProvider } = setup();
    let caught: unknown;
    try {
      await dataProvider.create("contacts", {
        data: {
          first_name: "Raw",
          last_name: "Write",
          company_id: 20,
          is_primary: true,
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.PRIMARY_CONTACT_CHANGED);
    expect(await primariesOf(dataProvider, 20)).toEqual([29]);
  });

  it("idempotent replay: same key + same payload → same contact, disposition replayed, no duplicate; different payload → conflict", async () => {
    const { dataProvider } = setup();
    const key = "0f1e2d3c-0000-4000-8000-00000000abcd";
    const payload = {
      first_name: "Idem",
      last_name: "Potent",
      company_id: 20,
      first_seen: "2026-09-08T10:00:00.000Z",
    };
    const first = await dataProvider.create("contacts", {
      data: {
        ...payload,
        ...intent(
          { kind: "make_primary", expectedCurrentPrimaryContactId: 29 },
          key,
        ),
      },
    });
    const second = await dataProvider.create("contacts", {
      data: {
        ...payload,
        first_seen: "2026-09-08T10:05:00.000Z",
        ...intent(
          { kind: "make_primary", expectedCurrentPrimaryContactId: 29 },
          key,
        ),
      },
    });
    expect(second.data.id).toBe(first.data.id);
    const ops = getDefaultOperationManager().getOperations();
    expect(ops.map((o) => o.execution).sort()).toEqual([
      "executed",
      "replayed",
    ]);
    const { total } = await dataProvider.getList("contacts", {
      filter: { company_id: 20 },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    expect(total).toBe(3);

    let caught: unknown;
    try {
      await dataProvider.create("contacts", {
        data: {
          ...payload,
          last_name: "Anders",
          ...intent(
            { kind: "make_primary", expectedCurrentPrimaryContactId: 29 },
            key,
          ),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  });

  it("idempotency fingerprint is the canonical business payload: keys the command ignores replay, a writable field conflicts", async () => {
    const { dataProvider } = setup();
    const key = "0f1e2d3c-0000-4000-8000-00000000fp01";
    const payload = {
      first_name: "Finger",
      last_name: "Abdruck",
      company_id: 20,
    };
    const first = await dataProvider.create("contacts", {
      data: { ...payload, ...intent({ kind: "keep" }, key) },
    });

    // Same business request, decorated with keys create_contact ignores
    // (view columns, UI helpers, volatile timestamps) → must replay.
    const second = await dataProvider.create("contacts", {
      data: {
        ...payload,
        company_name: "wird ignoriert",
        nb_notes: 7,
        unknown_ui_helper: true,
        first_seen: "2026-09-08T11:00:00.000Z",
        last_seen: "2026-09-08T11:30:00.000Z",
        ...intent({ kind: "keep" }, key),
      },
    });
    expect(second.data.id).toBe(first.data.id);
    expect(
      getDefaultOperationManager()
        .getOperations()
        .map((o) => o.execution)
        .sort(),
    ).toEqual(["executed", "replayed"]);

    // A real writable field differs → still a conflict.
    let caught: unknown;
    try {
      await dataProvider.create("contacts", {
        data: {
          ...payload,
          title: "Andere Rolle",
          ...intent({ kind: "keep" }, key),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(getDetails(caught)).toBe(NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT);
  });

  it("update matrix: B make primary, D clear, G move primary keeps it non-primary, H move + make primary demotes the target's holder", async () => {
    const { dataProvider, freddie, hans, greta } = setup();

    // B: Hans becomes primary, user saw Freddie
    const b = await dataProvider.update("contacts", {
      id: hans.id,
      data: {
        title: "Chef",
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: freddie.id,
        }),
      },
      previousData: hans,
    });
    expect(b.data.is_primary).toBe(true);
    expect(b.data.title).toBe("Chef");
    expect(await primariesOf(dataProvider, 20)).toEqual([hans.id]);

    // C: make_primary on the holder with a wrong expected → no-op success
    await dataProvider.update("contacts", {
      id: hans.id,
      data: {
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: freddie.id,
        }),
      },
      previousData: b.data,
    });
    expect(await primariesOf(dataProvider, 20)).toEqual([hans.id]);

    // D: clear → customer may have no primary
    await dataProvider.update("contacts", {
      id: hans.id,
      data: { ...intent({ kind: "clear" }) },
      previousData: b.data,
    });
    expect(await primariesOf(dataProvider, 20)).toEqual([]);

    // re-establish Freddie
    await dataProvider.update("contacts", {
      id: freddie.id,
      data: {
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: null,
        }),
      },
      previousData: freddie,
    });

    // G: move the primary (Freddie) to K2 with keep → non-primary there, Greta untouched, K1 empty
    const g = await dataProvider.update("contacts", {
      id: freddie.id,
      data: { company_id: 21, ...intent({ kind: "keep" }) },
      previousData: { ...freddie, is_primary: true },
    });
    expect(g.data.company_id).toBe(21);
    expect(g.data.is_primary).toBe(false);
    expect(await primariesOf(dataProvider, 21)).toEqual([greta.id]);
    expect(await primariesOf(dataProvider, 20)).toEqual([]);

    // H: move Hans to K2 and make him primary, user saw Greta
    const h = await dataProvider.update("contacts", {
      id: hans.id,
      data: {
        company_id: 21,
        ...intent({
          kind: "make_primary",
          expectedCurrentPrimaryContactId: greta.id,
        }),
      },
      previousData: hans,
    });
    expect(h.data.is_primary).toBe(true);
    expect(await primariesOf(dataProvider, 21)).toEqual([hans.id]);

    // I: remove the customer → is_primary false
    const i = await dataProvider.update("contacts", {
      id: hans.id,
      data: { company_id: null, ...intent({ kind: "keep" }) },
      previousData: h.data,
    });
    expect(i.data.is_primary).toBe(false);
    expect(await primariesOf(dataProvider, 21)).toEqual([]);

    // every save was exactly one contact.update operation
    const ops = getDefaultOperationManager().getOperations();
    expect(new Set(ops.map((o) => o.operationType))).toEqual(
      new Set(["contact.update"]),
    );
    expect(ops.every((o) => o.status === "success")).toBe(true);
  });

  it("partial updates without an intent (status, tags, last_seen) stay raw and never touch the primary", async () => {
    const { dataProvider, hans } = setup();
    const { data } = await dataProvider.update("contacts", {
      id: hans.id,
      data: { status: "hot" },
      previousData: hans,
    });
    expect(data.status).toBe("hot");
    expect(data.is_primary).toBe(false);
    expect(await primariesOf(dataProvider, 20)).toEqual([29]);
    expect(getDefaultOperationManager().getOperations()).toHaveLength(0);
  });

  it("setPrimaryContact keeps its contract on the shared slot rule", async () => {
    const { dataProvider, hans } = setup();
    await dataProvider.setPrimaryContact(hans.id);
    expect(await primariesOf(dataProvider, 20)).toEqual([hans.id]);
    await dataProvider.setPrimaryContact(hans.id);
    expect(await primariesOf(dataProvider, 20)).toEqual([hans.id]);
  });
});
