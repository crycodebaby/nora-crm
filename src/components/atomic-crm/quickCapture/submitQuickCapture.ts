import type { DataProvider, Identifier } from "ra-core";

import { cleanupContactForCreate } from "../contacts/contactModel";
import type { Company, Contact, Deal, Task } from "../types";
import {
  buildDealDescriptionWithSource,
  type QuickCaptureSourceChannel,
  type QuickCaptureTaskOption,
} from "./quickCaptureUtils";

export type QuickCaptureSubmitInput = {
  company: Company | null;
  newCompanyName: string;
  contact: Contact | null;
  newContact: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
  };
  dealTitle: string;
  dealCategory: string;
  dealDescription: string;
  sourceChannel: QuickCaptureSourceChannel;
  sourceLabel: string;
  followUpDate: string;
  taskType: QuickCaptureTaskOption;
  salesId: Identifier;
};

export type QuickCaptureSubmitResult = {
  dealId: Identifier;
  companyId: Identifier;
  contactId: Identifier;
  taskFailed?: boolean;
};

export class QuickCaptureSubmitError extends Error {
  constructor(
    message: string,
    public readonly stage: "company" | "contact" | "deal" | "task",
  ) {
    super(message);
    this.name = "QuickCaptureSubmitError";
  }
}

export async function submitQuickCapture(
  dataProvider: DataProvider,
  input: QuickCaptureSubmitInput,
): Promise<QuickCaptureSubmitResult> {
  let companyId = input.company?.id;
  let contactId = input.contact?.id;

  if (!companyId) {
    const name = input.newCompanyName.trim();
    if (!name) {
      throw new QuickCaptureSubmitError("company_name_required", "company");
    }
    try {
      const { data } = await dataProvider.create<Company>("companies", {
        data: {
          name,
          sales_id: input.salesId,
          created_at: new Date().toISOString(),
        } as Company,
      });
      companyId = data.id;
    } catch {
      throw new QuickCaptureSubmitError("company_create_failed", "company");
    }
  }

  if (!contactId) {
    const first_name = input.newContact.first_name.trim();
    const last_name = input.newContact.last_name.trim();
    if (!first_name || !last_name) {
      throw new QuickCaptureSubmitError("contact_name_required", "contact");
    }
    try {
      const email = input.newContact.email.trim();
      const phone = input.newContact.phone.trim();
      const { data } = await dataProvider.create<Contact>("contacts", {
        data: cleanupContactForCreate({
          first_name,
          last_name,
          title: "",
          company_id: companyId,
          sales_id: input.salesId,
          gender: "",
          status: "",
          background: "",
          has_newsletter: false,
          tags: [],
          email_jsonb: email
            ? [{ email, type: "Work" }]
            : [{ email: "", type: "Work" }],
          phone_jsonb: phone
            ? [{ number: phone, type: "Work" }]
            : [{ number: "", type: "Work" }],
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        } as unknown as Contact),
      });
      contactId = data.id;
    } catch {
      throw new QuickCaptureSubmitError("contact_create_failed", "contact");
    }
  }

  const description = buildDealDescriptionWithSource(
    input.sourceChannel,
    input.sourceLabel,
    input.dealDescription,
  );

  let deal: Deal;
  try {
    const { data } = await dataProvider.create<Deal>("deals", {
      data: {
        name: input.dealTitle.trim(),
        company_id: companyId,
        contact_ids: [contactId],
        category: input.dealCategory,
        stage: "neue-anfrage",
        description,
        amount: 0,
        expected_closing_date: input.followUpDate,
        sales_id: input.salesId,
        index: 0,
      } as Deal,
    });
    deal = data;
  } catch {
    throw new QuickCaptureSubmitError("deal_create_failed", "deal");
  }

  if (input.taskType) {
    const taskLabel =
      input.taskType === "rueckruf"
        ? "Rückruf"
        : input.taskType === "besichtigung"
          ? "Besichtigung"
          : "Angebot erstellen";
    try {
      await dataProvider.create<Task>("tasks", {
        data: {
          contact_id: contactId,
          type: input.taskType,
          text: taskLabel,
          due_date: input.followUpDate,
          sales_id: input.salesId,
        } as Task,
      });
    } catch {
      return {
        dealId: deal.id,
        companyId,
        contactId,
        taskFailed: true,
      };
    }
  }

  return {
    dealId: deal.id,
    companyId,
    contactId,
    taskFailed: false,
  };
}
