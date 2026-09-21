import { createDataProvider } from "./dataProvider";
import { createCrmDb } from "@/test/StoryWrapper";
import type { ContactNote } from "../../types";

/**
 * W8-C S5 (2026-09-21): FakeRest is not a projection — it has no
 * `public.attachments`, no grammar and no relational parity, so demo data
 * simply vouches for itself and every note it hands out is `ok`. It must
 * still speak the canonical S5 read contract, and it must not persist the
 * read-model metadata, which is not a stored field.
 *
 * It must also stop coercing a missing `attachments` key into `[]`: a partial
 * patch that never mentions attachments would otherwise wipe them.
 */
describe("FakeRest note attachment read contract (W8-C S5)", () => {
  const attachment = {
    path: "k1.pdf",
    title: "angebot.pdf",
    type: "application/pdf",
    src: "https://cdn.test/k1.pdf",
  };

  const setup = (attachments: unknown[] = [attachment]) =>
    createDataProvider({
      db: createCrmDb({
        contact_notes: [
          {
            id: 1,
            contact_id: 1,
            text: "Erstkontakt",
            date: "2026-09-20T10:00:00.000Z",
            sales_id: 1,
            status: "warm",
            attachments,
          } as unknown as ContactNote,
        ],
      }),
      silent: true,
      latency: 0,
    });

  it("stamps reads as ok and always exposes an array", async () => {
    const dataProvider = setup();

    const { data } = await dataProvider.getOne("contact_notes", { id: 1 });
    expect(data.attachments_state).toBe("ok");
    expect(data.attachments).toEqual([attachment]);

    const list = await dataProvider.getList("contact_notes", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(list.data[0].attachments_state).toBe("ok");
  });

  it("reads a note without attachments as verified empty, never null", async () => {
    const dataProvider = createDataProvider({
      db: createCrmDb({
        contact_notes: [
          {
            id: 1,
            contact_id: 1,
            text: "Ohne Anhang",
            date: "2026-09-20T10:00:00.000Z",
            sales_id: 1,
            status: "warm",
          } as unknown as ContactNote,
        ],
      }),
      silent: true,
      latency: 0,
    });

    const { data } = await dataProvider.getOne("contact_notes", { id: 1 });
    expect(data.attachments).toEqual([]);
    expect(data.attachments_state).toBe("ok");
  });

  it("preserves stored attachments across a partial patch", async () => {
    const dataProvider = setup();
    const { data: previousData } = await dataProvider.getOne("contact_notes", {
      id: 1,
    });

    await dataProvider.update("contact_notes", {
      id: 1,
      data: { text: "Nur Text geändert" },
      previousData,
    });

    const { data } = await dataProvider.getOne("contact_notes", { id: 1 });
    expect(data.text).toBe("Nur Text geändert");
    expect(data.attachments).toEqual([attachment]);
  });

  it("never persists the read-model metadata", async () => {
    const dataProvider = setup();
    const { data: previousData } = await dataProvider.getOne("contact_notes", {
      id: 1,
    });

    // a full form submit carries the read contract back in
    await dataProvider.update("contact_notes", {
      id: 1,
      data: {
        ...previousData,
        text: "Mit Metadaten gespeichert",
        attachments_unverified_legacy: [],
      },
      previousData,
    });

    const { data } = await dataProvider.getOne("contact_notes", { id: 1 });
    expect(data.attachments_unverified_legacy).toBeUndefined();
    // the state comes from the stamp on read, not from storage
    expect(data.attachments_state).toBe("ok");
    expect(data.attachments).toEqual([attachment]);
  });

  it("stamps mutation results too, so a create is immediately canonical", async () => {
    const dataProvider = setup();

    const { data } = await dataProvider.create("contact_notes", {
      data: {
        contact_id: 1,
        text: "Neue Notiz",
        date: "2026-09-21T10:00:00.000Z",
        sales_id: 1,
        status: "warm",
      },
    });

    expect(data.attachments_state).toBe("ok");
    expect(data.attachments).toEqual([]);
  });
});
