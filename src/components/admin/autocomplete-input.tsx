/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import { isValidElement, useCallback } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@/components/admin/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  ChoicesProps,
  InputProps,
  SupportCreateSuggestionOptions,
} from "ra-core";
import {
  useChoices,
  useChoicesContext,
  useGetRecordRepresentation,
  useInput,
  useTranslate,
  FieldTitle,
  useEvent,
  useSupportCreateSuggestion,
} from "ra-core";
import { InputHelperText } from "./input-helper-text";
import { PopoverProps } from "@radix-ui/react-popover";

/**
 * Form control that lets users choose a value from a list using a dropdown with autocompletion.
 *
 * This input allows editing scalar values with a searchable dropdown interface. It supports creating
 * new choices on the fly and works seamlessly inside ReferenceInput for editing foreign key relationships.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/autocompleteinput/ AutocompleteInput documentation}
 *
 * @example
 * import {
 *   Create,
 *   SimpleForm,
 *   AutocompleteInput,
 *   ReferenceInput,
 * } from '@/components/admin';
 *
 * const PostCreate = () => (
 *   <Create>
 *     <SimpleForm>
 *       <AutocompleteInput
 *         source="category"
 *         choices={[
 *           { id: 'tech', name: 'Tech' },
 *           { id: 'lifestyle', name: 'Lifestyle' },
 *           { id: 'people', name: 'People' },
 *         ]}
 *       />
 *       <ReferenceInput label="Author" source="author_id" reference="authors">
 *         <AutocompleteInput />
 *       </ReferenceInput>
 *     </SimpleForm>
 *   </Create>
 * );
 */
const EMPTY_CLIENT_FILTER_FIELDS: string[] = [];

export const AutocompleteInput = (
  props: Omit<InputProps, "source"> &
    Omit<SupportCreateSuggestionOptions, "handleChange" | "filter"> &
    Partial<Pick<InputProps, "source">> &
    ChoicesProps & {
      className?: string;
      disableValue?: string;
      filterToQuery?: (searchText: string) => any;
      clientFilter?: boolean;
      clientFilterFields?: string[];
      translateChoice?: boolean;
      placeholder?: string;
      inputText?:
        | React.ReactNode
        | ((option: any | undefined) => React.ReactNode);
      mobileSheet?: {
        title: React.ReactNode;
        description?: React.ReactNode;
        emptyText?: React.ReactNode;
      };
    } & Pick<PopoverProps, "modal">,
) => {
  const {
    filterToQuery = DefaultFilterToQuery,
    inputText,
    create,
    createValue,
    createLabel,
    createHintValue,
    createItemLabel,
    onCreate,
    optionText,
    modal,
    mobileSheet,
    clientFilter = false,
    clientFilterFields = EMPTY_CLIENT_FILTER_FIELDS,
  } = props;
  const {
    allChoices = [],
    source,
    resource,
    isFromReference,
    setFilters,
  } = useChoicesContext(props);
  const { id, field, isRequired } = useInput({ ...props, source });
  const uniqueId = React.useId();
  const translate = useTranslate();
  const { placeholder = translate("ra.action.search", { _: "Search..." }) } =
    props;

  const getRecordRepresentation = useGetRecordRepresentation(resource);
  const { getChoiceText, getChoiceValue } = useChoices({
    optionText:
      props.optionText ?? (isFromReference ? getRecordRepresentation : "name"),
    optionValue: props.optionValue ?? "id",
    disableValue: props.disableValue,
    translateChoice: props.translateChoice ?? !isFromReference,
  });

  const [filterValue, setFilterValue] = React.useState("");
  const listRef = React.useRef<HTMLDivElement>(null);

  const [open, setOpen] = React.useState(false);
  const selectedChoice = allChoices.find(
    (choice) => getChoiceValue(choice) === field.value,
  );

  const getInputText = useCallback(
    (selectedChoice: any) => {
      if (typeof inputText === "function") {
        return inputText(selectedChoice);
      }
      if (inputText !== undefined) {
        return inputText;
      }
      return getChoiceText(selectedChoice);
    },
    [inputText, getChoiceText],
  );

  const handleOpenChange = useEvent((isOpen: boolean) => {
    setOpen(isOpen);
    // Reset the filter when the popover is closed
    if (!isOpen) {
      setFilters(filterToQuery(""));
    }
  });

  const handleChange = useCallback(
    (choice: any) => {
      if (field.value === getChoiceValue(choice) && !isRequired) {
        field.onChange("");
        setFilterValue("");
        if (isFromReference) {
          setFilters(filterToQuery(""));
        }
        setOpen(false);
        return;
      }
      field.onChange(getChoiceValue(choice));
      setOpen(false);
    },
    [
      field,
      getChoiceValue,
      isRequired,
      setFilterValue,
      isFromReference,
      setFilters,
      filterToQuery,
      setOpen,
    ],
  );

  const {
    getCreateItem,
    handleChange: handleChangeWithCreateSupport,
    createElement,
    getOptionDisabled,
  } = useSupportCreateSuggestion({
    create,
    createLabel,
    createValue,
    createHintValue,
    createItemLabel,
    onCreate,
    handleChange,
    optionText,
    filter: filterValue,
  });

  const createItem =
    (create || onCreate) && (filterValue !== "" || createLabel)
      ? getCreateItem(filterValue)
      : null;

  const handleFilterChange = (filter: string) => {
    setFilterValue(filter);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo(0, 0);
    });
    // We don't want the ChoicesContext to filter the choices if the input
    // is not from a reference as it would also filter out selected values.
    if (isFromReference) {
      setFilters(filterToQuery(filter));
    }
  };

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-labelledby={uniqueId}
      className="h-auto min-h-11 w-full justify-between py-1.75 font-normal"
    >
      {selectedChoice ? (
        <span className="truncate">{getInputText(selectedChoice)}</span>
      ) : (
        <span className="truncate text-muted-foreground">{placeholder}</span>
      )}
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const choices = (
    <CommandGroup>
      {allChoices.map((choice) => {
        const choiceText = getChoiceText(choice);
        const choiceKeywords = isValidElement(choiceText)
          ? undefined
          : [
              choiceText,
              ...clientFilterFields.flatMap((fieldName) => {
                const value = choice[fieldName];
                return value == null ? [] : [String(value)];
              }),
            ];

        return (
          <CommandItem
            key={getChoiceValue(choice)}
            value={getChoiceValue(choice)}
            keywords={choiceKeywords}
            onSelect={() => handleChangeWithCreateSupport(choice)}
            className={cn(mobileSheet && "min-h-12 rounded-lg px-3")}
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4",
                field.value === getChoiceValue(choice)
                  ? "opacity-100"
                  : "opacity-0",
              )}
            />
            <span className="truncate">{choiceText}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );

  const createChoice = createItem ? (
    <CommandItem
      key={getChoiceValue(createItem)}
      // Include the filter value so the option is shown even when the filter
      // starts or ends with a space.
      value={`?${filterValue}?`}
      onSelect={() => handleChangeWithCreateSupport(createItem)}
      disabled={getOptionDisabled(createItem)}
      className={cn(
        "font-medium text-primary data-[selected=true]:text-primary",
        mobileSheet &&
          "min-h-12 rounded-lg px-3 text-[var(--nora-brand)] data-[selected=true]:text-[var(--nora-brand)]",
      )}
    >
      <Plus className="mr-2 h-4 w-4 shrink-0" />
      <span className="truncate">{getChoiceText(createItem)}</span>
    </CommandItem>
  ) : null;

  return (
    <>
      <FormField className={props.className} id={id} name={source}>
        {props.label !== false && (
          <FormLabel id={uniqueId}>
            <FieldTitle
              label={props.label}
              source={props.source ?? source}
              resource={resource}
              isRequired={isRequired}
            />
          </FormLabel>
        )}
        <FormControl>
          {mobileSheet ? (
            <Sheet open={open} onOpenChange={handleOpenChange}>
              <SheetTrigger asChild>{trigger}</SheetTrigger>
              <SheetContent
                side="bottom"
                className="h-[min(86dvh,44rem)] gap-0 overflow-hidden rounded-t-2xl p-0"
              >
                <SheetHeader className="border-b px-4 pb-3 pr-14 pt-4 text-left">
                  <SheetTitle className="text-lg">
                    {mobileSheet.title}
                  </SheetTitle>
                  {mobileSheet.description ? (
                    <SheetDescription>
                      {mobileSheet.description}
                    </SheetDescription>
                  ) : null}
                </SheetHeader>
                <Command
                  shouldFilter={!isFromReference || clientFilter}
                  className="min-h-0 flex-1 rounded-none bg-background"
                >
                  <CommandInput
                    autoFocus
                    placeholder={placeholder}
                    value={filterValue}
                    onValueChange={handleFilterChange}
                    className="h-12 text-base"
                  />
                  <CommandList
                    ref={listRef}
                    className="min-h-0 max-h-none flex-1 px-2 py-2"
                  >
                    <CommandEmpty>
                      {mobileSheet.emptyText ?? "No matching item found."}
                    </CommandEmpty>
                    {choices}
                  </CommandList>
                  {createChoice ? (
                    <div className="border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                      <CommandGroup className="p-0">
                        {createChoice}
                      </CommandGroup>
                    </div>
                  ) : null}
                </Command>
              </SheetContent>
            </Sheet>
          ) : (
            <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
              <PopoverTrigger asChild>{trigger}</PopoverTrigger>
              <PopoverContent className="w-full max-w-(--radix-popover-trigger-width) p-0">
                {/* We handle the filtering ourselves */}
                <Command shouldFilter={!isFromReference || clientFilter}>
                  <CommandInput
                    placeholder={placeholder}
                    value={filterValue}
                    onValueChange={handleFilterChange}
                  />
                  <CommandList ref={listRef}>
                    <CommandEmpty>No matching item found.</CommandEmpty>
                    {choices}
                    {createChoice ? (
                      <>
                        {allChoices.length > 0 && <CommandSeparator />}
                        <CommandGroup>{createChoice}</CommandGroup>
                      </>
                    ) : null}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </FormControl>
        <InputHelperText helperText={props.helperText} />
        <FormError />
      </FormField>
      {createElement}
    </>
  );
};

const DefaultFilterToQuery = (searchText: string) => ({ q: searchText });
