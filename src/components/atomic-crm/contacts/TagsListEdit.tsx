import { Plus, Settings2, TagIcon } from "lucide-react";
import {
  useGetMany,
  useNotify,
  useRecordContext,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { withTag, withoutTag } from "../application/commands/ensureTag";
import { normalizeCrmError } from "../misc/normalizeCrmError";
import { TagChip } from "../tags/TagChip";
import { TagCreateModal } from "../tags/TagCreateModal";
import { TagManagerDialog } from "../tags/TagManagerDialog";
import { useTags } from "../tags/useTags";
import type { Contact, Tag } from "../types";

/** Above this many Markierungen the picker gets a search field; below it, searching would be noise. */
const SEARCH_THRESHOLD = 8;

export const TagsListEdit = () => {
  const record = useRecordContext<Contact>();
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const translate = useTranslate();
  const notify = useNotify();

  const { data: allTags, isPending: isPendingAllTags } = useTags();
  const { data: tags, isPending: isPendingRecordTags } = useGetMany<Tag>(
    "tags",
    { ids: record?.tags },
    { enabled: record && record.tags && record.tags.length > 0 },
  );
  const [update] = useUpdate<Contact>(undefined, undefined, {
    returnPromise: true,
  });

  const unselectedTags = useMemo(
    () =>
      allTags && record
        ? allTags.filter((tag) => !record.tags?.includes(tag.id))
        : [],
    [allTags, record],
  );

  /**
   * One write path for "this contact should carry this Markierung". Null-safe
   * and idempotent by construction — `withTag` is what the Production
   * incident was missing (contacts.tags was NULL and the old code spread it
   * unguarded, throwing AFTER the tags row had been created).
   */
  const attachTag = useCallback(
    async (tag: Tag) => {
      if (!record) {
        throw new Error("No contact record found");
      }
      const nextTags = withTag(record.tags, tag.id);
      if (nextTags.length === (record.tags ?? []).length) {
        // Already attached — nothing to write, but still a terminal answer.
        return;
      }
      await update("contacts", {
        id: record.id,
        data: { tags: nextTags },
        previousData: record,
      });
    },
    [record, update],
  );

  const handleTagAdd = useCallback(
    async (tag: Tag) => {
      setPickerOpen(false);
      try {
        await attachTag(tag);
        notify("resources.tags.notification.assigned", {
          type: "success",
          messageArgs: { name: tag.name },
        });
      } catch (error) {
        notify(normalizeCrmError(error).messageKey, { type: "error" });
      }
    },
    [attachTag, notify],
  );

  const handleTagDelete = useCallback(
    async (tag: Tag) => {
      if (!record) {
        throw new Error("No contact record found");
      }
      try {
        await update("contacts", {
          id: record.id,
          data: { tags: withoutTag(record.tags, tag.id) },
          previousData: record,
        });
        notify("resources.tags.notification.removed", {
          type: "info",
          messageArgs: { name: tag.name },
        });
      } catch (error) {
        notify(normalizeCrmError(error).messageKey, { type: "error" });
      }
    },
    [notify, record, update],
  );

  /**
   * Runs inside the create dialog's submit. Throwing here keeps the dialog
   * open with an error instead of closing on a half-done operation — the
   * "create succeeded, attach failed" case the user must be told about.
   */
  const handleTagCreated = useCallback(
    async (tag: Tag, created: boolean) => {
      await attachTag(tag);
      setCreateOpen(false);
      notify(
        created
          ? "resources.tags.notification.created_and_assigned"
          : "resources.tags.notification.existing_and_assigned",
        { type: "success", messageArgs: { name: tag.name } },
      );
    },
    [attachTag, notify],
  );

  if (isPendingRecordTags || isPendingAllTags) return null;

  const showSearch = (allTags?.length ?? 0) > SEARCH_THRESHOLD;

  return (
    <div className="flex flex-wrap gap-2">
      {tags?.map((tag) => (
        <div key={tag.id}>
          <TagChip tag={tag} onUnlink={() => handleTagDelete(tag)} />
        </div>
      ))}

      <div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 md:h-6 cursor-pointer"
            >
              <Plus className="w-4 h-4 md:w-3 md:h-3 mr-1" />
              {translate("resources.tags.action.add")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-64" align="start">
            <Command>
              {showSearch && (
                <CommandInput
                  placeholder={translate("resources.tags.action.search")}
                />
              )}
              <CommandList>
                {/* Assigning an existing Markierung is the common path and
                    comes first; creating a global one is deliberately below
                    the separator as the secondary action. */}
                <CommandEmpty>
                  {translate("resources.tags.action.none_found")}
                </CommandEmpty>
                {unselectedTags.length > 0 && (
                  <CommandGroup
                    heading={translate("resources.tags.action.existing")}
                  >
                    {unselectedTags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => handleTagAdd(tag)}
                        className="cursor-pointer"
                      >
                        <Badge
                          variant="secondary"
                          className="text-sm md:text-xs font-normal text-black"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </Badge>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value={translate("resources.tags.action.create")}
                    onSelect={() => {
                      setPickerOpen(false);
                      setCreateOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <TagIcon className="w-4 h-4 md:w-3 md:h-3 mr-2" />
                    {translate("resources.tags.action.create")}
                  </CommandItem>
                  <CommandItem
                    value={translate("resources.tags.action.manage")}
                    onSelect={() => {
                      setPickerOpen(false);
                      setManageOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <Settings2 className="w-4 h-4 md:w-3 md:h-3 mr-2" />
                    {translate("resources.tags.action.manage")}
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <TagCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleTagCreated}
      />
      <TagManagerDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </div>
  );
};
