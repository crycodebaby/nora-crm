/**
 * Kontakt → Kundenakte (Self Contact Wave, 2026-08-26). Reuses the existing
 * contact's personal data — no re-entry of name/email/phone/links. Calls
 * only the CreateCustomerFromContact Application Command
 * (application/commands/createCustomerFromContact.ts); no dataProvider/RPC
 * orchestration lives in this component.
 */
import { useState } from "react";
import {
  useDataProvider,
  useGetIdentity,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";

import type { Contact, CustomerKind } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { noraCreatePath } from "../routing/noraRoutes";
import { customerKindChoices } from "../companies/customerKind";
import {
  createCustomerFromContact,
  ExistingPrivateCustomerRecordError,
} from "../application/commands/createCustomerFromContact";

type ContactToCustomerDialogProps = {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ContactToCustomerDialog = ({
  contact,
  open,
  onOpenChange,
}: ContactToCustomerDialogProps) => {
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();

  const [customerKind, setCustomerKind] = useState<CustomerKind>("individual");
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [city, setCity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [existingRecordId, setExistingRecordId] = useState<
    string | number | null
  >(null);

  const contactName =
    `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();

  const reset = () => {
    setCustomerKind("individual");
    setCompanyName("");
    setAddress("");
    setZipcode("");
    setCity("");
    setExistingRecordId(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (customerKind === "business" && !companyName.trim()) {
      notify("crm.validation.company_name_required", { type: "error" });
      return;
    }
    setSubmitting(true);
    setExistingRecordId(null);
    try {
      const result = await createCustomerFromContact(dataProvider, {
        contactId: contact.id,
        customerKind,
        company:
          customerKind === "individual"
            ? { name: contactName, sales_id: identity?.id }
            : {
                name: companyName.trim(),
                address: address.trim() || undefined,
                zipcode: zipcode.trim() || undefined,
                city: city.trim() || undefined,
                sales_id: identity?.id,
              },
      });
      notify("crm.contact_to_customer.success", { type: "info" });
      handleOpenChange(false);
      redirect(
        noraCreatePath({
          resource: "companies",
          type: "show",
          id: result.companyId,
        }),
      );
    } catch (error) {
      if (error instanceof ExistingPrivateCustomerRecordError) {
        setExistingRecordId(error.companyId);
        return;
      }
      notify("crm.contact_to_customer.error", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate("crm.contact_to_customer.title", {
              name: contactName,
              _: `Kundenakte für ${contactName} anlegen`,
            })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {existingRecordId != null ? (
            <div className="nora-card p-4 space-y-3">
              <p className="text-sm">
                {translate("crm.contact_to_customer.existing_private_record", {
                  name: contactName,
                  _: `${contactName} hat bereits eine Privatkundenakte.`,
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  handleOpenChange(false);
                  redirect(
                    noraCreatePath({
                      resource: "companies",
                      type: "show",
                      id: existingRecordId,
                    }),
                  );
                }}
              >
                {translate("crm.contact_to_customer.open_existing", {
                  _: "Bestehende Kundenakte öffnen",
                })}
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>
                  {translate("resources.companies.fields.customer_kind")}
                </Label>
                <RadioGroup
                  value={customerKind}
                  onValueChange={(value) =>
                    setCustomerKind(value as CustomerKind)
                  }
                  className="flex flex-row gap-6"
                >
                  {customerKindChoices.map((choice) => (
                    <div key={choice.value} className="flex items-center gap-2">
                      <RadioGroupItem
                        value={choice.value}
                        id={`contact-to-customer-${choice.value}`}
                      />
                      <Label htmlFor={`contact-to-customer-${choice.value}`}>
                        {translate(choice.label, { _: choice.defaultLabel })}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {customerKind === "individual" ? (
                <p className="text-sm text-muted-foreground">
                  {translate("crm.contact_to_customer.individual_preview", {
                    name: contactName,
                    _: `Kundenakte für ${contactName} — Name, E-Mail, Telefon und Links werden aus dem Ansprechpartner-Datensatz übernommen.`,
                  })}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-to-customer-company-name">
                      {translate("resources.companies.fields.name")}
                    </Label>
                    <Input
                      id="contact-to-customer-company-name"
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      className="nora-touch-target"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>
                        {translate("resources.companies.fields.address")}
                      </Label>
                      <Input
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        className="nora-touch-target"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {translate("resources.companies.fields.city")}
                      </Label>
                      <Input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        className="nora-touch-target"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        {translate("resources.companies.fields.zipcode")}
                      </Label>
                      <Input
                        value={zipcode}
                        onChange={(event) => setZipcode(event.target.value)}
                        className="nora-touch-target"
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {translate("crm.contact_to_customer.business_preview", {
                      name: contactName,
                      _: `${contactName} bleibt Ansprechpartner, wo er/sie es bereits ist, und wird zusätzlich als die Person hinter dieser neuen Kundenakte hinterlegt.`,
                    })}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {translate("crm.quick_capture.cancel")}
          </Button>
          {existingRecordId == null ? (
            <Button
              type="button"
              className="nora-primary-action"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {translate("crm.contact_to_customer.submit", {
                _: "Kundenakte anlegen",
              })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
