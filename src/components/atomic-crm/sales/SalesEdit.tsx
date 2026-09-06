import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useEditController,
  useGetIdentity,
  useNotify,
  useRecordContext,
  useRedirect,
  useTranslate,
} from "ra-core";
import type { SubmitHandler } from "react-hook-form";
import { SimpleForm } from "@/components/admin/simple-form";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { Card, CardContent } from "@/components/ui/card";

import type { CrmDataProvider } from "../providers/types";
import { syncCurrentSaleCacheIfSelf } from "../providers/supabase/authProvider";
import type { Sale, SalesFormData } from "../types";
import { SalesInputs } from "./SalesInputs";
import { buildSalesEditPatch } from "./salesEditPatch";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import { NoraPageLoading } from "../misc/NoraPageLoading";

function EditToolbar() {
  return (
    <div className="flex justify-end gap-4">
      <CancelButton />
      <SaveButton />
    </div>
  );
}

export function SalesEdit() {
  const { record } = useEditController();
  const { canAccess, isPending } = useCanAccess({
    resource: "sales",
    action: "edit",
  });
  const redirect = useRedirect();

  useEffect(() => {
    if (!isPending && !canAccess) {
      redirect("/sales");
    }
  }, [canAccess, isPending, redirect]);

  if (isPending || !canAccess) {
    return <NoraPageLoading variant="inline" className="py-12" />;
  }

  return <SalesEditForm record={record} />;
}

function SalesEditForm({ record }: { record: Sale | undefined }) {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();
  const { identity, refetch: refetchIdentity } = useGetIdentity();

  const { mutate } = useMutation({
    mutationKey: ["sales-edit"],
    mutationFn: async (data: SalesFormData) => {
      if (!record) {
        throw new Error(
          translate("resources.sales.edit.record_not_found", {
            _: "Record not found",
          }),
        );
      }

      const patch = buildSalesEditPatch(record, data);
      // Nothing changed (e.g. "Speichern" right after "E-Mail-Adresse ändern",
      // which already persisted through its own command): do not send an
      // empty PATCH — the server refuses it as invalid_payload, which used to
      // surface as a misleading role error.
      if (Object.keys(patch).length === 0) {
        return record;
      }

      return dataProvider.salesUpdate(record.id, patch);
    },
    onSuccess: (sale) => {
      syncCurrentSaleCacheIfSelf(sale, identity?.id);
      if (identity && String(sale.id) === String(identity.id)) {
        void refetchIdentity();
      }
      redirect("/sales");
      notify("resources.sales.edit.success", {
        messageArgs: {
          _: "Benutzer erfolgreich aktualisiert",
        },
      });
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      if (message === "role_update_forbidden") {
        notify("resources.sales.edit.role_forbidden", {
          type: "error",
          messageArgs: {
            _: "Sie sind nicht berechtigt, Benutzerrollen zu ändern.",
          },
        });
        return;
      }
      if (message === "self_access_change_forbidden") {
        notify("resources.sales.edit.self_forbidden", {
          type: "error",
          messageArgs: {
            _: "Den eigenen Nora-Zugang und die eigene Rolle können Sie hier nicht ändern.",
          },
        });
        return;
      }
      if (message === "last_active_admin_required") {
        notify("resources.sales.edit.last_admin_required", {
          type: "error",
          messageArgs: {
            _: "Mindestens ein aktiver Administrator muss erhalten bleiben.",
          },
        });
        return;
      }
      if (message === "employee_access_sync_incomplete") {
        notify("resources.sales.edit.access_sync_incomplete", {
          type: "error",
          messageArgs: {
            _: "Der Zugangsstatus konnte nicht vollständig angewendet werden. Bitte im Bereich „Nora-Zugang“ synchronisieren.",
          },
        });
        return;
      }
      if (message === "invalid_role" || message === "invalid_payload") {
        notify("resources.sales.edit.role_failed", {
          type: "error",
          messageArgs: {
            _: "Die Benutzerrolle konnte nicht geändert werden.",
          },
        });
        return;
      }
      notify("resources.sales.edit.error", {
        type: "error",
        messageArgs: {
          _: "Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.",
        },
      });
    },
  });

  const onSubmit: SubmitHandler<SalesFormData> = async (data) => {
    mutate(data);
  };

  return (
    <div className="max-w-lg w-full mx-auto mt-8">
      <Card>
        <CardContent>
          <SimpleForm
            toolbar={<EditToolbar />}
            onSubmit={onSubmit as SubmitHandler<Record<string, unknown>>}
            record={record}
          >
            <SaleEditTitle />
            {record ? (
              <>
                <EmployeeAccessPanel salesId={record.id} />
                <hr className="my-6 border-border" />
              </>
            ) : null}
            <SalesInputs />
          </SimpleForm>
        </CardContent>
      </Card>
    </div>
  );
}

const SaleEditTitle = () => {
  const record = useRecordContext<Sale>();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <h2 className="text-lg font-semibold mb-4">
      {translate("resources.sales.edit.title", {
        name: `${record.first_name} ${record.last_name}`,
      })}
    </h2>
  );
};
