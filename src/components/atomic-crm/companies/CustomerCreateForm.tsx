/**
 * Referenzimplementierung /kunden/create — Customer & Contact Workflow Wave.
 *
 * Ersetzt das reine CreateBase (dataProvider.create("companies", …)) durch
 * einen kontrollierten Submit, der je nach Kundenart (Unternehmen/Selbstständig
 * vs. Privatperson) und Ansprechpartner-Modus (kein/neu/selbst/bestehend) die
 * atomare RPC `create_customer_with_contact` über
 * dataProvider.createCustomerWithContact(...) aufruft — ein DB-Write, kein
 * halbfertiger Zustand bei Teilfehlern (siehe AGENTS-Auftrag Abschnitt 5).
 */
import { useState } from "react";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import type { FieldValues } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { TextInput } from "@/components/admin/text-input";
import { RadioButtonGroupInput } from "@/components/admin/radio-button-group-input";

import { CompanyInputs } from "./CompanyInputs";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { normalizeCrmError } from "../misc/normalizeCrmError";
import { noraCreatePath } from "../routing/noraRoutes";
import {
  contactGender,
  translateContactGenderLabel,
} from "../contacts/contactModel";
import type { CreateCustomerWithContactResult } from "../operations/executeCreateCustomerWithContact";
import type { CrmDataProvider } from "../providers/types";
import {
  CustomerContactCaptureInputs,
  CONTACT_CAPTURE_FIELD,
} from "./CustomerContactCaptureInputs";
import { buildCustomerCreatePayload } from "./buildCustomerCreatePayload";
import { DEFAULT_CUSTOMER_STATE_ABBR } from "./customerCreateDefaults";

export const CustomerCreateForm = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: FieldValues) => {
    setSubmitting(true);
    try {
      const payload = buildCustomerCreatePayload(values);
      if (!payload.ok) {
        notify(`crm.validation.${payload.error}`, { type: "error" });
        return;
      }

      const result = (await dataProvider.createCustomerWithContact(
        payload.params,
      )) as CreateCustomerWithContactResult;

      notify("resources.companies.notifications.created", {
        type: "info",
      });
      redirect(
        noraCreatePath({
          resource: "companies",
          type: "show",
          id: result.company_id,
        }),
      );
    } catch (error) {
      const normalized = normalizeCrmError(error);
      notify(normalized.messageKey, { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <NoraAccessGuard resource="companies" action="create" redirectTarget="list">
      <div className="mt-2 flex lg:mr-72">
        <div className="flex-1">
          <Form
            resource="companies"
            onSubmit={handleSubmit}
            defaultValues={{
              sales_id: identity?.id,
              customer_kind: "business",
              // Regionaler Standardfall (Customer Create Speed & Clarity Wave):
              // Bundesland startet mit NRW, bleibt frei überschreibbar. Land
              // wird nicht angezeigt und in buildCustomerCreatePayload gesetzt.
              state_abbr: DEFAULT_CUSTOMER_STATE_ABBR,
              [CONTACT_CAPTURE_FIELD]: "new",
              contact_gender: contactGender[0].value,
            }}
          >
            <Card>
              <CardContent>
                <CompanyInputs variant="create" />
                <CustomerKindAwareContactSection />
                <div
                  role="toolbar"
                  className="sticky flex pt-4 pb-4 md:pb-0 bottom-0 bg-linear-to-b from-transparent to-card to-10% flex-row justify-end gap-2"
                >
                  <CancelButton />
                  <SaveButton
                    disabled={submitting}
                    label={translate("resources.companies.action.create", {
                      _: "Create Company",
                    })}
                  />
                </div>
              </CardContent>
            </Card>
          </Form>
        </div>
      </div>
    </NoraAccessGuard>
  );
};

/** Business → Ansprechpartner-Modus-Auswahl. Privatperson → Personendaten direkt (kein Modus nötig). */
const CustomerKindAwareContactSection = () => {
  const translate = useTranslate();
  const customerKind = useWatch({
    name: "customer_kind",
    defaultValue: "business",
  });

  if (customerKind === "individual") {
    return (
      <div className="nora-form-section">
        <h6>
          {translate("resources.companies.field_categories.person", {
            _: "Persönliche Angaben",
          })}
        </h6>
        <RadioButtonGroupInput
          label={false}
          row
          source="contact_gender"
          choices={contactGender}
          helperText={false}
          optionText={(choice) =>
            translateContactGenderLabel(choice, translate)
          }
          translateChoice={false}
          optionValue="value"
          defaultValue={contactGender[0].value}
        />
        <TextInput
          source="contact_first_name"
          label="resources.contacts.fields.first_name"
          validate={required}
          helperText={false}
        />
        <TextInput
          source="contact_last_name"
          label="resources.contacts.fields.last_name"
          validate={required}
          helperText={false}
        />
      </div>
    );
  }

  return <CustomerContactCaptureInputs />;
};

const required = (value: unknown) =>
  !value ? "ra.validation.required" : undefined;
