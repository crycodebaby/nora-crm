import React from "react";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { useGetSalesName } from "./useGetSalesName";

/**
 * User Lifecycle W2: historical owner/author names resolve through
 * `sales_identities`, which keeps disabled employees. `sales_directory`
 * (assignment pickers) deliberately does not contain them.
 */
const ACTIVE = { id: 1, first_name: "Anna", last_name: "Aktiv", avatar: null };
const DISABLED = {
  id: 2,
  first_name: "Erika",
  last_name: "Ehemalig",
  avatar: null,
};

const createProvider = () => {
  const provider = fakeDataProvider({
    sales_directory: [ACTIVE],
    sales_identities: [
      { ...ACTIVE, disabled: false },
      { ...DISABLED, disabled: true },
    ],
  });
  const calls: string[] = [];
  return {
    calls,
    provider: {
      ...provider,
      getMany: (resource: string, params: any) => {
        calls.push(resource);
        return provider.getMany(resource, params);
      },
    },
  };
};

const NameProbe = ({ id }: { id: number }) => {
  const name = useGetSalesName(id);
  return <span data-testid="name">[{name}]</span>;
};

const Wrapper = ({
  dataProvider,
  children,
}: {
  dataProvider: any;
  children: React.ReactNode;
}) => (
  <CoreAdminContext dataProvider={dataProvider}>{children}</CoreAdminContext>
);

describe("useGetSalesName (W2 historical identity)", () => {
  it("resolves a disabled employee by name on existing records", async () => {
    const { provider, calls } = createProvider();
    const screen = await render(
      <Wrapper dataProvider={provider}>
        <NameProbe id={DISABLED.id} />
      </Wrapper>,
    );

    await vi.waitFor(() => {
      expect(screen.container.textContent).toContain("[Erika Ehemalig]");
    });
    expect(calls).toContain("sales_identities");
    expect(calls).not.toContain("sales_directory");
  });

  it("still resolves an active employee", async () => {
    const { provider } = createProvider();
    const screen = await render(
      <Wrapper dataProvider={provider}>
        <NameProbe id={ACTIVE.id} />
      </Wrapper>,
    );

    await vi.waitFor(() => {
      expect(screen.container.textContent).toContain("[Anna Aktiv]");
    });
  });
});
