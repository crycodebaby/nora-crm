import { buildSalesEditPatch } from "./salesEditPatch";
import type { Sale, SalesFormData } from "../types";

const record = {
  id: 4,
  first_name: "Peter",
  last_name: "Gibson",
  email: "viktoria.p@ergart.de",
  role: "office",
  administrator: false,
  disabled: true,
  user_id: "ba3c1b38-7104-478a-8c69-353347f26585",
} as unknown as Sale;

const form = (over: Partial<SalesFormData> = {}): SalesFormData =>
  ({
    first_name: "Peter",
    last_name: "Gibson",
    email: "viktoria.p@ergart.de",
    role: "office",
    disabled: true,
    ...over,
  }) as SalesFormData;

describe("buildSalesEditPatch", () => {
  it("is empty when nothing changed, so no PATCH is sent (W4 no-op save)", () => {
    expect(buildSalesEditPatch(record, form())).toEqual({});
  });

  it("never carries the login email, even when the form value differs", () => {
    const patch = buildSalesEditPatch(
      record,
      form({ email: "peter.gibson.w4test@ergart.de", first_name: "Petra" }),
    );
    expect(patch).toEqual({ first_name: "Petra" });
    expect("email" in patch).toBe(false);
  });

  it("sends only the changed profile and access fields", () => {
    expect(
      buildSalesEditPatch(record, form({ role: "viewer", disabled: false })),
    ).toEqual({ role: "viewer", disabled: false });
  });
});
