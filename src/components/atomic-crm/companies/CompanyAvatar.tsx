import { useRecordContext } from "ra-core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useAttachmentUrl } from "../attachments/useAttachmentUrl";
import type { Company } from "../types";

export const CompanyAvatar = (props: {
  record?: Company;
  width?: 20 | 40;
  height?: 20 | 40;
}) => {
  const { width = 40 } = props;
  const record = useRecordContext<Company>(props);
  // A customer logo is a deliberately PUBLIC brand mark (W8-E Decision A), so
  // it resolves from its public branding URL — it is never signed. The hook
  // still owns the URL policy, so an unsafe stored value renders no image at
  // all instead of reaching the DOM.
  const access = useAttachmentUrl(record?.logo, "branding");
  if (!record) return null;

  const sizeClass = width !== 40 ? `w-[20px] h-[20px]` : "w-10 h-10";

  return (
    <Avatar className={sizeClass}>
      <AvatarImage
        src={access.previewUrl}
        alt={record.name}
        className="object-contain"
      />
      <AvatarFallback className={width !== 40 ? "text-xs" : "text-sm"}>
        {record.name.charAt(0)}
      </AvatarFallback>
    </Avatar>
  );
};
