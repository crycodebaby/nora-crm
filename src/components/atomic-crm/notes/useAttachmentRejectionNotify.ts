import { useCallback } from "react";
import { useNotify } from "ra-core";

import type { AttachmentFileRejection } from "../providers/commons/attachments";

export type RejectedAttachment = {
  name: string;
  reason: AttachmentFileRejection;
};

/**
 * Tells the user which selected files were not attached and why — one
 * notification per reason. UX only: the attachments bucket enforces the limits.
 */
export const useAttachmentRejectionNotify = () => {
  const notify = useNotify();

  return useCallback(
    (rejected: RejectedAttachment[]) => {
      const reasons: AttachmentFileRejection[] = ["file_type", "file_size"];
      for (const reason of reasons) {
        const names = rejected
          .filter((file) => file.reason === reason)
          .map((file) => file.name);
        if (names.length === 0) continue;
        notify(`resources.notes.validation.attachment_${reason}`, {
          type: "error",
          messageArgs: { names: names.join(", "), smart_count: names.length },
        });
      }
    },
    [notify],
  );
};
