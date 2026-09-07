import { ResourceContextProvider, ShowBase, useDataProvider } from "ra-core";
import type { DataProvider } from "ra-core";
import { render } from "vitest-browser-react";

import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { TagsListEdit } from "./TagsListEdit";

/**
 * Regression suite for the Production Markierungen incident (2026-09-07).
 *
 * The reproduced failure: on a contact whose contacts.tags column was NULL,
 * pressing "Speichern" in the create dialog wrote a tags row, then threw
 * `TypeError: record.tags is not iterable` while attaching it. The dialog
 * stayed open with no error, so the user pressed Speichern again — and got a
 * second row. Five such rows reached Production.
 */
const renderTagsEditor = async (
  contactOverrides: Record<string, unknown> = {},
  tags: { id: number; name: string; color: string }[] = [],
) => {
  let dataProvider: DataProvider | null = null;
  const contact = buildContact({ id: 1, ...contactOverrides } as never);

  const Listener = () => {
    dataProvider = useDataProvider();
    return null;
  };

  const screen = await render(
    <StoryWrapper data={{ contacts: [contact], tags }}>
      <Listener />
      <ResourceContextProvider value="contacts">
        <ShowBase id={contact.id}>
          <TagsListEdit />
        </ShowBase>
      </ResourceContextProvider>
    </StoryWrapper>,
  );

  const getDp = () => dataProvider!;
  const listTags = async () => {
    const { data } = await getDp().getList("tags", {
      filter: {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    return data;
  };
  const getContactTags = async () => {
    const { data } = await getDp().getOne("contacts", { id: contact.id });
    return data.tags ?? [];
  };

  const openCreateDialog = async () => {
    await screen.getByRole("button", { name: "Add tag" }).click();
    await screen.getByRole("option", { name: /Create new tag/ }).click();
  };

  return { screen, contact, getDp, listTags, getContactTags, openCreateDialog };
};

/**
 * FakeRest simulates 300ms per request, and a create round is
 * getList + create + update — comfortably past expect.poll's 1s default.
 */
const POLL = { timeout: 8000 } as const;

describe("TagsListEdit — create", () => {
  it("attaches the new Markierung to a contact whose tags column is NULL (the incident)", async () => {
    const { screen, listTags, getContactTags, openCreateDialog } =
      await renderTagsEditor({ tags: undefined });

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(1);
    const [created] = await listTags();
    await expect.poll(getContactTags, POLL).toEqual([created.id]);
  });

  it("closes the dialog and shows the created tag as a chip", async () => {
    const { screen, openCreateDialog } = await renderTagsEditor({
      tags: undefined,
    });

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(() => document.querySelectorAll('[role="dialog"]').length, POLL)
      .toBe(0);
    await expect.element(screen.getByText("Privatperson")).toBeVisible();
  });

  it("reports success explicitly", async () => {
    const { screen, openCreateDialog } = await renderTagsEditor({
      tags: undefined,
    });

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText(/Tag .Privatperson. was created and added\./))
      .toBeVisible();
  });

  it("a repeated Save on the same dialog creates the Markierung ONCE", async () => {
    const { screen, listTags, openCreateDialog } = await renderTagsEditor({
      tags: undefined,
    });

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("Privatperson");

    // Two presses in the SAME tick — an impatient double click. React has not
    // re-rendered in between, so only a synchronous guard can stop the second.
    const save = screen
      .getByRole("button", { name: "Save" })
      .element() as HTMLButtonElement;
    save.click();
    save.click();
    save.click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(1);
    // …and it stays one after everything has settled.
    expect(await listTags()).toHaveLength(1);
  });

  it("reuses an existing Markierung with a different case instead of creating a second row", async () => {
    const { screen, listTags, getContactTags, openCreateDialog } =
      await renderTagsEditor({ tags: undefined }, [
        { id: 3, name: "Privatperson", color: "#99c1de" },
      ]);

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("  privatperson ");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(1);
    await expect.poll(getContactTags, POLL).toEqual([3]);
    await expect
      .element(
        screen.getByText(/Tag .Privatperson. already exists and was added\./),
      )
      .toBeVisible();
  });

  it("warns before submitting that the typed name already exists", async () => {
    const { screen, openCreateDialog } = await renderTagsEditor({}, [
      { id: 3, name: "Privatperson", color: "#99c1de" },
    ]);

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("privatperson");

    await expect
      .element(screen.getByText(/already exists and will be used/))
      .toBeVisible();
  });

  it("keeps the dialog open with an error when the attach fails after the tag was created", async () => {
    let dataProvider: DataProvider | null = null;
    const contact = buildContact({ id: 1, tags: undefined as never });

    const Listener = () => {
      dataProvider = useDataProvider();
      return null;
    };

    const screen = await render(
      <StoryWrapper
        data={{ contacts: [contact], tags: [] }}
        dataProvider={{
          update: (async (resource: string) => {
            if (resource === "contacts") {
              throw new Error("Failed to fetch");
            }
            throw new Error("unexpected");
          }) as never,
        }}
      >
        <Listener />
        <ResourceContextProvider value="contacts">
          <ShowBase id={contact.id}>
            <TagsListEdit />
          </ShowBase>
        </ResourceContextProvider>
      </StoryWrapper>,
    );

    await screen.getByRole("button", { name: "Add tag" }).click();
    await screen.getByRole("option", { name: /Create new tag/ }).click();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    // The dialog must NOT close on a half-done operation, and must say why.
    await expect.element(screen.getByRole("alert")).toBeVisible();
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);

    // Retrying after the ambiguous response reuses the row already written.
    const { data: tagsAfter } = await dataProvider!.getList("tags", {
      filter: {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    expect(tagsAfter).toHaveLength(1);

    await screen.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(async () => {
        const { data } = await dataProvider!.getList("tags", {
          filter: {},
          pagination: { page: 1, perPage: 100 },
          sort: { field: "id", order: "ASC" },
        });
        return data.length;
      }, POLL)
      .toBe(1);
  });

  it("refuses a blank name — Save stays disabled", async () => {
    const { screen, openCreateDialog } = await renderTagsEditor();

    await openCreateDialog();
    await screen.getByLabelText("Tag name").fill("   ");

    await expect
      .element(screen.getByRole("button", { name: "Save" }))
      .toBeDisabled();
  });
});

describe("TagsListEdit — assign and remove", () => {
  it("assigns an existing Markierung to a contact with NULL tags", async () => {
    const { screen, getContactTags } = await renderTagsEditor(
      { tags: undefined },
      [{ id: 3, name: "Privatperson", color: "#99c1de" }],
    );

    await screen.getByRole("button", { name: "Add tag" }).click();
    await screen.getByRole("option", { name: "Privatperson" }).click();

    await expect.poll(getContactTags, POLL).toEqual([3]);
    await expect
      .element(screen.getByText(/Tag .Privatperson. was added\./))
      .toBeVisible();
  });

  it("does not offer a Markierung the contact already carries", async () => {
    const { screen } = await renderTagsEditor({ tags: [3] }, [
      { id: 3, name: "Privatperson", color: "#99c1de" },
      { id: 4, name: "Kunde AE", color: "#f0efeb" },
    ]);

    await screen.getByRole("button", { name: "Add tag" }).click();

    await expect
      .element(screen.getByRole("option", { name: "Kunde AE" }))
      .toBeVisible();
    expect(
      screen.container.ownerDocument.querySelectorAll(
        '[role="option"][data-value="Privatperson"]',
      ).length,
    ).toBe(0);
  });

  it("removes a Markierung from the contact", async () => {
    const { screen, getContactTags } = await renderTagsEditor({ tags: [3] }, [
      { id: 3, name: "Privatperson", color: "#99c1de" },
    ]);

    await expect.element(screen.getByText("Privatperson")).toBeVisible();
    await screen.getByRole("button", { name: "" }).first().click();

    await expect.poll(getContactTags, POLL).toEqual([]);
  });
});

describe("TagsListEdit — picker scale", () => {
  it("offers a search field once the vocabulary grows past the compact set", async () => {
    const manyTags = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      name: `Markierung ${String(index + 1).padStart(2, "0")}`,
      color: "#99c1de",
    }));
    const { screen } = await renderTagsEditor({ tags: [] }, manyTags);

    await screen.getByRole("button", { name: "Add tag" }).click();
    const search = screen.getByPlaceholder(/Search tag/);
    await expect.element(search).toBeVisible();

    await search.fill("Markierung 11");
    await expect
      .element(screen.getByRole("option", { name: "Markierung 11" }))
      .toBeVisible();
  });

  it("shows no search field for a small vocabulary", async () => {
    const { screen } = await renderTagsEditor({ tags: [] }, [
      { id: 1, name: "Kunde AE", color: "#99c1de" },
    ]);

    await screen.getByRole("button", { name: "Add tag" }).click();
    await expect
      .element(screen.getByRole("option", { name: "Kunde AE" }))
      .toBeVisible();
    expect(
      screen.container.ownerDocument.querySelectorAll("[cmdk-input]").length,
    ).toBe(0);
  });
});
