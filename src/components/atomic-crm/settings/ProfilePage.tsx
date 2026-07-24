import { useMutation } from "@tanstack/react-query";
import { Check, CircleX, Copy, Pencil, Save } from "lucide-react";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useGetOne,
  useLocaleState,
  useLocales,
  useNotify,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { useFormState } from "react-hook-form";
import { RecordField } from "@/components/admin/record-field";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import ImageEditorField from "../misc/ImageEditorField";
import { normalizePersonName } from "../misc/personName";
import type { CrmDataProvider } from "../providers/types";
import {
  setCurrentSaleCache,
  syncCurrentSaleCacheIfSelf,
} from "../providers/supabase/authProvider";
import { getSupabaseClient } from "../providers/supabase/supabase";
import type { Sale, SalesFormData } from "../types";

export const ProfilePage = () => {
  const [isEditMode, setEditMode] = useState(false);
  const { identity, refetch: refetchIdentity } = useGetIdentity();
  const { data, refetch: refetchUser } = useGetOne("sales", {
    id: identity?.id,
  });
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate } = useMutation({
    mutationKey: ["profile-update"],
    mutationFn: async (formValues: SalesFormData) => {
      if (!identity || !data) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }

      const first_name = String(formValues.first_name ?? "").trim();
      const last_name = String(formValues.last_name ?? "").trim();
      const email = String(formValues.email ?? "").trim();
      const emailChanged = Boolean(email) && email !== data.email;

      // Name (and unchanged email) can be saved via RLS + auth metadata —
      // avoids the users edge function privilege path for simple profile edits.
      if (!emailChanged) {
        const client = getSupabaseClient();
        const { error: metaError } = await client.auth.updateUser({
          data: { first_name, last_name },
        });
        if (metaError) throw metaError;

        const { data: sale, error: saleError } = await client
          .from("sales")
          .update({ first_name, last_name })
          .eq("id", identity.id)
          .select(
            "id, first_name, last_name, avatar, administrator, role, disabled",
          )
          .single();
        if (saleError || !sale) throw saleError ?? new Error("Update failed");
        return sale as Sale;
      }

      return dataProvider.salesUpdate(identity.id, {
        first_name,
        last_name,
        email,
        avatar: formValues.avatar,
        role: data.role,
        administrator: data.administrator,
        disabled: data.disabled,
      });
    },
    onSuccess: (sale) => {
      setCurrentSaleCache(sale);
      void refetchIdentity();
      void refetchUser();
      setEditMode(false);
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: (_) => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred. Please try again",
        },
      });
    },
  });

  if (!identity) return null;

  const handleOnSubmit = async (values: any) => {
    mutate(values);
  };

  const formRecord = data
    ? {
        ...data,
        first_name: normalizePersonName(data.first_name),
        last_name: normalizePersonName(data.last_name),
      }
    : data;

  return (
    <div className="max-w-lg mx-auto mt-8">
      <Form onSubmit={handleOnSubmit} record={formRecord}>
        <ProfileForm isEditMode={isEditMode} setEditMode={setEditMode} />
      </Form>
    </div>
  );
};

const ProfileForm = ({
  isEditMode,
  setEditMode,
}: {
  isEditMode: boolean;
  setEditMode: (value: boolean) => void;
}) => {
  const notify = useNotify();
  const translate = useTranslate();
  const record = useRecordContext<Sale>();
  const { identity, refetch } = useGetIdentity();
  const { isDirty } = useFormState();
  const dataProvider = useDataProvider<CrmDataProvider>();

  const { mutate: updatePassword } = useMutation({
    mutationKey: ["updatePassword"],
    mutationFn: async () => {
      if (!identity) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.updatePassword(identity.id);
    },
    onSuccess: () => {
      notify("crm.profile.password_reset_sent", {
        messageArgs: {
          _: "A reset password email has been sent to your email address",
        },
      });
    },
    onError: (e) => {
      notify(`${e}`, {
        type: "error",
      });
    },
  });

  const { mutate: mutateSale } = useMutation({
    mutationKey: ["profile-avatar-update"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("crm.profile.record_not_found", {
            _: "Record not found",
          }),
        );
      }
      return dataProvider.salesUpdate(record.id, data);
    },
    onSuccess: (sale) => {
      syncCurrentSaleCacheIfSelf(sale, identity?.id);
      void refetch();
      notify("crm.profile.updated", {
        messageArgs: {
          _: "Your profile has been updated",
        },
      });
    },
    onError: () => {
      notify("crm.profile.update_error", {
        type: "error",
        messageArgs: {
          _: "An error occurred. Please try again.",
        },
      });
    },
  });
  if (!identity) return null;

  const handleClickOpenPasswordChange = () => {
    updatePassword();
  };

  const handleAvatarUpdate = async (values: any) => {
    mutateSale(values);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <div className="mb-4 flex flex-row justify-between">
            <h2 className="text-xl font-semibold text-muted-foreground">
              {translate("crm.profile.title")}
            </h2>
          </div>

          <div className="space-y-4 mb-4">
            <ImageEditorField
              source="avatar"
              type="avatar"
              onSave={handleAvatarUpdate}
              linkPosition="right"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextRender source="first_name" isEditMode={isEditMode} />
              <TextRender source="last_name" isEditMode={isEditMode} />
            </div>
            <TextRender source="email" isEditMode={isEditMode} />
            <LanguageSelector />
          </div>

          <div className="flex flex-row justify-end gap-2">
            {!isEditMode && (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleClickOpenPasswordChange}
                >
                  {translate("crm.profile.password.change")}
                </Button>
              </>
            )}

            <Button
              type="button"
              variant={isEditMode ? "ghost" : "outline"}
              onClick={() => setEditMode(!isEditMode)}
              className="flex items-center"
            >
              {isEditMode ? <CircleX /> : <Pencil />}
              {isEditMode
                ? translate("ra.action.cancel")
                : translate("ra.action.edit")}
            </Button>

            {isEditMode && (
              <Button type="submit" disabled={!isDirty} variant="outline">
                <Save />
                {translate("ra.action.save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {import.meta.env.VITE_INBOUND_EMAIL && (
        <Card>
          <CardContent>
            <div className="space-y-4 justify-between">
              <h2 className="text-xl font-semibold text-muted-foreground">
                {translate("crm.profile.inbound.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {translate("crm.profile.inbound.description", {
                  _: "Sie können E-Mails an die Eingangsadresse Ihres Servers senden, z. B. indem Sie sie in das Feld Cc setzen. Nora CRM verarbeitet die E-Mails und fügt Notizen zu den passenden Kontakten hinzu.",
                  field: "Cc:",
                })}
              </p>
              <CopyPaste value={import.meta.env.VITE_INBOUND_EMAIL} />
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <div className="space-y-4 justify-between">
            <h2 className="text-xl font-semibold text-muted-foreground">
              {translate("crm.profile.mcp.title", {
                _: "MCP Server",
              })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("crm.profile.mcp.description", {
                _: "Use this URL to connect your AI assistant to your CRM data via the Model Context Protocol (MCP).",
              })}
            </p>
            <CopyPaste
              value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const LanguageSelector = () => {
  const translate = useTranslate();
  const locales = useLocales();
  const [locale, setLocale] = useLocaleState();

  if (locales.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {translate("crm.language")}
      </p>
      <Select value={locale} onValueChange={setLocale}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map((language) => (
            <SelectItem key={language.locale} value={language.locale}>
              {language.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const TextRender = ({
  source,
  isEditMode,
  className,
}: {
  source: string;
  isEditMode: boolean;
  className?: string;
}) => {
  const label = `resources.sales.fields.${source}`;
  if (isEditMode) {
    return (
      <TextInput
        source={source}
        label={label}
        helperText={false}
        className={className}
      />
    );
  }
  return (
    <div className={className}>
      <RecordField source={source} label={label} />
    </div>
  );
};

const CopyPaste = ({ value }: { value: string }) => {
  const translate = useTranslate();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    setCopied(true);
    navigator.clipboard.writeText(value);
    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            onClick={handleCopy}
            variant="ghost"
            className="normal-case justify-between w-full"
          >
            <span className="overflow-hidden text-ellipsis">{value}</span>
            {copied ? (
              <Check className="h-4 w-4 ml-2" />
            ) : (
              <Copy className="h-4 w-4 ml-2" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {copied
              ? translate("crm.common.copied")
              : translate("crm.common.copy")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

ProfilePage.path = "/profile";
