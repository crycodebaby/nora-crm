import type { CustomerKind } from "../types";

export const customerKindChoices: {
  value: CustomerKind;
  label: string;
  defaultLabel: string;
}[] = [
  {
    value: "business",
    label: "resources.companies.inputs.customer_kind.business",
    defaultLabel: "Firma",
  },
  {
    value: "individual",
    label: "resources.companies.inputs.customer_kind.individual",
    defaultLabel: "Privatperson",
  },
];
