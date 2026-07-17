import { useState } from "react";
import { useTranslate } from "ra-core";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { NoraRole } from "../providers/commons/canAccess";
import {
  DEMO_ROLE_EMAILS,
  DEMO_SALES_BY_ROLE,
} from "../providers/fakerest/demoSession";
import { isNoraDemoMode } from "./noraDemoMode";
import { useNoraRole } from "./useNoraRole";
import { useSwitchDemoRole } from "./useSwitchDemoRole";

export const DEMO_ROLE_USERS = {
  admin: {
    email: DEMO_ROLE_EMAILS.admin,
    labelKey: "crm.demo.roles.admin",
  },
  office: {
    email: DEMO_ROLE_EMAILS.office,
    labelKey: "crm.demo.roles.office",
  },
  viewer: {
    email: DEMO_ROLE_EMAILS.viewer,
    labelKey: "crm.demo.roles.viewer",
  },
} as const satisfies Record<NoraRole, { email: string; labelKey: string }>;

/** Demo-only role switcher — never shown in production Supabase mode. */
export const DemoRoleSwitcher = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const { role, isPending } = useNoraRole();
  const { switchRole } = useSwitchDemoRole();
  const [switching, setSwitching] = useState(false);

  if (!isNoraDemoMode) return null;

  const handleRoleChange = async (nextRole: NoraRole) => {
    if (nextRole === role || switching) return;
    setSwitching(true);
    try {
      await switchRole(nextRole, role);
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div className={className}>
      <label className="sr-only" htmlFor="nora-demo-role-switcher">
        {translate("crm.demo.role_switcher_label")}
      </label>
      <Select
        value={isPending ? undefined : role}
        onValueChange={(value) => handleRoleChange(value as NoraRole)}
        disabled={switching || isPending}
      >
        <SelectTrigger
          id="nora-demo-role-switcher"
          className="h-8 w-[11rem] text-xs border-dashed"
          aria-label={translate("crm.demo.role_switcher_label")}
        >
          <SelectValue
            placeholder={
              switching
                ? translate("crm.demo.role_switching")
                : translate("crm.demo.role_switcher_label")
            }
          />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DEMO_SALES_BY_ROLE) as NoraRole[]).map((demoRole) => (
            <SelectItem key={demoRole} value={demoRole}>
              {translate(DEMO_ROLE_USERS[demoRole].labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="hidden lg:block text-[10px] text-muted-foreground mt-0.5 max-w-[11rem] leading-tight">
        {translate("crm.demo.role_switcher_hint")}
      </p>
    </div>
  );
};
