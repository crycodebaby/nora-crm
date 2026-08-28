import { useCreate, useGetIdentity, useNotify, useTranslate } from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import type { InputProps } from "ra-core";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PopoverProps } from "@radix-ui/react-popover";

export const AutocompleteCompanyInput = ({
  validate,
  label,
  modal,
}: Pick<InputProps, "validate" | "label"> & Pick<PopoverProps, "modal">) => {
  const [create] = useCreate();
  const { identity } = useGetIdentity();
  const notify = useNotify();
  const translate = useTranslate();
  const handleCreateCompany = async (name?: string) => {
    if (!name) return;
    try {
      const newCompany = await create(
        "companies",
        {
          data: {
            name,
            sales_id: identity?.id,
            created_at: new Date().toISOString(),
          },
        },
        { returnPromise: true },
      );
      return newCompany;
    } catch {
      notify("resources.companies.autocomplete.create_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred while creating the company",
        },
      });
    }
  };
  const isMobile = useIsMobile();

  return (
    <AutocompleteInput
      label={label}
      optionText="name"
      helperText={false}
      onCreate={handleCreateCompany}
      createItemLabel="resources.companies.autocomplete.create_item"
      createLabel="resources.companies.autocomplete.create_label"
      validate={validate}
      modal={modal ?? isMobile}
      clientFilter
      clientFilterFields={["customer_number"]}
      placeholder={translate(
        "resources.companies.autocomplete.search_placeholder",
      )}
      mobileSheet={
        isMobile
          ? {
              title: translate("resources.companies.autocomplete.select_title"),
              description: translate(
                "resources.companies.autocomplete.select_description",
              ),
              emptyText: translate("resources.companies.autocomplete.empty"),
            }
          : undefined
      }
    />
  );
};
