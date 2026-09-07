import { Pencil, Trash2 } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
} from "ra-core";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { normalizeCrmError } from "../misc/normalizeCrmError";
import type { Contact, Tag } from "../types";
import { TagEditModal } from "./TagEditModal";
import { useTags } from "./useTags";

type TagManagerDialogProps = {
  open: boolean;
  onClose(): void;
};

/**
 * "Markierungen verwalten" (Markierungen Identity Wave, 2026-09-07).
 *
 * Deliberately small: rename, recolour, see how often a Markierung is used,
 * and delete one that nobody uses. It exists because the tag vocabulary is
 * otherwise only reachable THROUGH a contact that already carries the tag —
 * which left the five duplicate rows from the Production incident
 * unreachable and therefore uncorrectable from the UI.
 *
 * Deleting is offered only at usage 0. A used Markierung would leave stale
 * ids inside contacts.tags, and nora_private.guard_tag_delete() refuses it
 * server-side regardless of what this dialog shows.
 */
export function TagManagerDialog({ open, onClose }: TagManagerDialogProps) {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider();
  const [editing, setEditing] = useState<Tag | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<
    Tag["id"] | null
  >(null);
  const [busyId, setBusyId] = useState<Tag["id"] | null>(null);

  const { data: tags = [], isPending: isPendingTags } = useTags({
    enabled: open,
  });
  // One request instead of one per Markierung. Nora is a small-business CRM;
  // if the contact count ever outgrows this, the counts belong in a view.
  const { data: contacts = [], isPending: isPendingContacts } =
    useGetList<Contact>(
      "contacts",
      {
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
      },
      { enabled: open },
    );

  const usageByTagId = useMemo(() => {
    const usage = new Map<Tag["id"], number>();
    for (const contact of contacts) {
      for (const tagId of contact.tags ?? []) {
        usage.set(tagId, (usage.get(tagId) ?? 0) + 1);
      }
    }
    return usage;
  }, [contacts]);

  const handleDelete = async (tag: Tag) => {
    setBusyId(tag.id);
    try {
      await dataProvider.delete("tags", { id: tag.id, previousData: tag });
      notify("resources.tags.notification.deleted", {
        type: "success",
        messageArgs: { name: tag.name },
      });
      setConfirmingDeleteId(null);
      refresh();
    } catch (error) {
      notify(normalizeCrmError(error).messageKey, { type: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const isPending = isPendingTags || isPendingContacts;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setConfirmingDeleteId(null);
            onClose();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {translate("resources.tags.manage.title")}
            </DialogTitle>
            <DialogDescription>
              {translate("resources.tags.manage.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-96 overflow-y-auto -mx-2 px-2">
            {isPending ? (
              <p className="text-sm text-muted-foreground py-4">
                {translate("crm.common.loading")}
              </p>
            ) : tags.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {translate("resources.tags.manage.empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {tags.map((tag) => {
                  const usage = usageByTagId.get(tag.id) ?? 0;
                  const isConfirming = confirmingDeleteId === tag.id;
                  return (
                    <li
                      key={tag.id}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <Badge
                          variant="secondary"
                          className="font-normal text-black"
                          style={{ backgroundColor: tag.color }}
                        >
                          {tag.name}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {translate("resources.tags.manage.usage", {
                            smart_count: usage,
                          })}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={busyId === tag.id}
                              onClick={() => handleDelete(tag)}
                            >
                              {translate(
                                "resources.tags.manage.confirm_delete",
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              {translate("ra.action.cancel")}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={translate(
                                "resources.tags.manage.rename",
                                { name: tag.name },
                              )}
                              onClick={() => setEditing(tag)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={usage > 0}
                              title={
                                usage > 0
                                  ? translate(
                                      "resources.tags.manage.in_use_hint",
                                    )
                                  : undefined
                              }
                              aria-label={translate(
                                "resources.tags.manage.delete",
                                { name: tag.name },
                              )}
                              onClick={() => setConfirmingDeleteId(tag.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {editing && (
        <TagEditModal
          tag={editing}
          open
          onClose={() => setEditing(null)}
          onSuccess={async (tag) => {
            setEditing(null);
            notify("resources.tags.notification.updated", {
              type: "success",
              messageArgs: { name: tag.name },
            });
            refresh();
          }}
        />
      )}
    </>
  );
}
