import { useDataProvider, type DataProvider } from "ra-core";
import { render } from "vitest-browser-react";

import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { TagManagerDialog } from "./TagManagerDialog";

const POLL = { timeout: 8000 } as const;

const renderManager = async (
  tags: { id: number; name: string; color: string }[],
  contacts = [buildContact({ id: 1, tags: [] })],
) => {
  let dataProvider: DataProvider | null = null;
  const Listener = () => {
    dataProvider = useDataProvider();
    return null;
  };

  const screen = await render(
    <StoryWrapper data={{ contacts, tags }}>
      <Listener />
      <TagManagerDialog open onClose={() => undefined} />
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

  return { screen, listTags };
};

describe("TagManagerDialog", () => {
  it("shows how often each Markierung is used", async () => {
    const { screen } = await renderManager(
      [
        { id: 1, name: "Kunde AE", color: "#99c1de" },
        { id: 2, name: "Privatperso", color: "#99c1de" },
      ],
      [
        buildContact({ id: 1, tags: [1] }),
        buildContact({ id: 2, tags: [1] }),
        buildContact({ id: 3, tags: [] }),
      ],
    );

    await expect.element(screen.getByText("Used by 2 contacts")).toBeVisible();
    await expect.element(screen.getByText("Used by 0 contacts")).toBeVisible();
  });

  it("deletes an unused Markierung — the Production leftovers become reachable", async () => {
    const { screen, listTags } = await renderManager([
      { id: 1, name: "Privatperso", color: "#99c1de" },
    ]);

    await screen
      .getByRole("button", { name: /Delete tag .Privatperso.$/ })
      .click();
    await screen.getByRole("button", { name: "Really delete" }).click();

    await expect.poll(async () => (await listTags()).length, POLL).toBe(0);
  });

  it("does not offer deletion for a Markierung that is in use", async () => {
    const { screen } = await renderManager(
      [{ id: 1, name: "Kunde AE", color: "#99c1de" }],
      [buildContact({ id: 1, tags: [1] })],
    );

    await expect
      .element(screen.getByRole("button", { name: /Delete tag .Kunde AE.$/ }))
      .toBeDisabled();
  });

  it("renames a Markierung", async () => {
    const { screen, listTags } = await renderManager([
      { id: 1, name: "Privatperso", color: "#99c1de" },
    ]);

    await screen
      .getByRole("button", { name: /Edit tag .Privatperso.$/ })
      .click();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => (await listTags()).map((tag) => tag.name), POLL)
      .toEqual(["Privatperson"]);
  });

  it("REFUSES a rename that would collide, instead of silently merging", async () => {
    const { screen, listTags } = await renderManager([
      { id: 1, name: "Privatperson", color: "#99c1de" },
      { id: 2, name: "Privatperso", color: "#99c1de" },
    ]);

    await screen
      .getByRole("button", { name: /Edit tag .Privatperso.$/ })
      .click();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(/already exists/);

    // Both rows survive untouched — merging is never implicit.
    expect((await listTags()).map((tag) => tag.name).sort()).toEqual([
      "Privatperso",
      "Privatperson",
    ]);
  });

  it("warns about the collision before the user even presses Save", async () => {
    const { screen } = await renderManager([
      { id: 1, name: "Privatperson", color: "#99c1de" },
      { id: 2, name: "Privatperso", color: "#99c1de" },
    ]);

    await screen
      .getByRole("button", { name: /Edit tag .Privatperso.$/ })
      .click();
    await screen.getByLabelText("Tag name").fill("privatperson");

    await expect
      .element(screen.getByText(/already exists and will be used/))
      .toBeVisible();
  });

  it("allows renaming a Markierung to a different case of its OWN name", async () => {
    const { screen, listTags } = await renderManager([
      { id: 1, name: "privatperson", color: "#99c1de" },
    ]);

    await screen
      .getByRole("button", { name: /Edit tag .privatperson.$/ })
      .click();
    await screen.getByLabelText("Tag name").fill("Privatperson");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => (await listTags()).map((tag) => tag.name), POLL)
      .toEqual(["Privatperson"]);
  });
});
