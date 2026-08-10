/**
 * Shared ReferenceInput props for public.sales_directory.
 * The view already filters disabled=false and does not expose `disabled`.
 */
export const SALES_DIRECTORY_REFERENCE_PROPS = {
  reference: "sales_directory" as const,
  sort: { field: "last_name" as const, order: "ASC" as const },
  perPage: 100,
};
