import {
  ListBase,
  ResourceContextProvider,
  useDataProvider,
  useListContext,
} from "ra-core";
import type { DataProvider } from "ra-core";
import { useEffect } from "react";
import { render } from "vitest-browser-react";

import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { BulkTagButton } from "./BulkTagButton";

const POLL = { timeout: 8000 } as const;

/**
 * Bulk tagging must share the single-contact creation semantics: creating a
 * Markierung that already exists reuses it instead of adding a second row
 * (Markierungen Identity Wave, 2026-09-07).
 */
const SelectAll = ({ ids }: { ids: number[] }) => {
  // Bring the list into a "rows selected" state without depending on the
  // ContactList markup or driving checkboxes.
  const { onSelect } = useListContext();
  useEffect(() => {
    onSelect(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const renderBulk = async (
  contacts: ReturnType<typeof buildContact>[],
  tags: { id: number; name: string; color: string }[],
) => {
  let dataProvider: DataProvider | null = null;
  const Listener = () => {
    dataProvider = useDataProvider();
    return null;
  };

  const screen = await render(
    <StoryWrapper data={{ contacts, tags }}>
      <Listener />
      <ResourceContextProvider value="contacts">
        <ListBase perPage={50}>
          <SelectAll ids={contacts.map((contact) => Number(contact.id))} />
          <BulkTagButton />
        </ListBase>
      </ResourceContextProvider>
    </StoryWrapper>,
  );

  const listTags = async () => {
    const { data } = await dataProvider!.getList("tags", {
      filter: {},
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    });
    return data;
  };
  const contactTags = async (id: number) => {
    const { data } = await dataProvider!.getOne("contacts", { id });
    return data.tags ?? [];
  };

  return { screen, listTags, contactTags };
};

describe("BulkTagButton", () => {
  it("creating a Markierung that already exists reuses it instead of adding a row", async () => {
    const { screen, listTags, contactTags } = await renderBulk(
      [
        buildContact({ id: 1, first_name: "A", tags: [] }),
        buildContact({ id: 2, first_name: "B", tags: [] }),
      ],
      [{ id: 3, name: "Privatperson", color: "#99c1de" }],
    );

    await screen.getByRole("button", { name: "Tag" }).click();
    await screen.getByRole("button", { name: /Create new tag/ }).click();
    await screen.getByLabelText("Tag name").fill("privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(1);
    await expect.poll(() => contactTags(1), POLL).toEqual([3]);
    await expect.poll(() => contactTags(2), POLL).toEqual([3]);
  });

  it("applies an existing Markierung and reports how many contacts changed", async () => {
    const { screen, contactTags } = await renderBulk(
      [
        buildContact({ id: 1, first_name: "A", tags: [] }),
        // Already tagged — must not be counted as changed.
        buildContact({ id: 2, first_name: "B", tags: [3] }),
      ],
      [{ id: 3, name: "Privatperson", color: "#99c1de" }],
    );

    await screen.getByRole("button", { name: "Tag" }).click();
    await screen.getByRole("button", { name: "Privatperson" }).click();

    await expect
      .element(screen.getByText("Tag added to 1 contact"))
      .toBeVisible();
    await expect.poll(() => contactTags(1), POLL).toEqual([3]);
    await expect.poll(() => contactTags(2), POLL).toEqual([3]);
  });

  it("attaching a Markierung a contact already carries leaves ONE id", async () => {
    const { screen, contactTags } = await renderBulk(
      [buildContact({ id: 1, first_name: "A", tags: [3] })],
      [{ id: 3, name: "Privatperson", color: "#99c1de" }],
    );

    await screen.getByRole("button", { name: "Tag" }).click();
    await screen.getByRole("button", { name: "Privatperson" }).click();

    await expect
      .element(screen.getByText("Selected contacts already have this tag"))
      .toBeVisible();
    expect(await contactTags(1)).toEqual([3]);
  });

  it("creates a genuinely new Markierung and applies it to every selected contact", async () => {
    const { screen, listTags, contactTags } = await renderBulk(
      [
        buildContact({ id: 1, first_name: "A", tags: [] }),
        buildContact({ id: 2, first_name: "B", tags: [] }),
      ],
      [],
    );

    await screen.getByRole("button", { name: "Tag" }).click();
    await screen.getByRole("button", { name: /Create new tag/ }).click();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(1);
    const [created] = await listTags();
    await expect.poll(() => contactTags(1), POLL).toEqual([created.id]);
    await expect.poll(() => contactTags(2), POLL).toEqual([created.id]);
  });
});
