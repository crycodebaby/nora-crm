import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";

import { NoraRouteProgress } from "./NoraRouteProgress";

const renderWithClient = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <NoraRouteProgress />
    </QueryClientProvider>,
  );

const expectActive = async (value: "true" | "false") => {
  await expect
    .poll(() =>
      page
        .getByTestId("nora-route-progress")
        .element()
        .getAttribute("data-active"),
    )
    .toBe(value);
};

describe("NoraRouteProgress", () => {
  it("is inactive and decorative while no query or mutation is running", async () => {
    renderWithClient(new QueryClient());

    await expectActive("false");
    const el = page.getByTestId("nora-route-progress").element();
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("activates while a query is in flight and deactivates afterwards", async () => {
    const client = new QueryClient();
    renderWithClient(client);

    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve("done");
    });
    const pending = client.fetchQuery({
      queryKey: ["nora-route-progress-test"],
      queryFn: () => gate,
    });

    await expectActive("true");

    release();
    await pending;

    await expectActive("false");
  });

  it("activates while a mutation is in flight", async () => {
    const client = new QueryClient();
    renderWithClient(client);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observer = new MutationObserver(client, {
      mutationFn: () => gate,
    });
    const pending = observer.mutate();

    await expectActive("true");

    release();
    await pending;

    await expectActive("false");
  });
});
