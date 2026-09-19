import { describe, expect, it } from "vitest";

import { NORA_ERROR_CODES, NORA_ERROR_DEFINITIONS } from "./noraErrorCodes";
import { englishCrmMessages } from "../providers/commons/englishCrmMessages";
import { frenchCrmMessages } from "../providers/commons/frenchCrmMessages";
import { germanCrmMessages } from "../providers/commons/germanCrmMessages";
import s3aMigration from "../../../../supabase/migrations/20260919120000_nora_attachment_reference_serialization.sql?raw";
import s3bMigration from "../../../../supabase/migrations/20260919180000_nora_attachment_note_projection.sql?raw";

const resolve = (catalog: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );

const CATALOGS = {
  en: englishCrmMessages,
  de: germanCrmMessages,
  fr: frenchCrmMessages,
};

describe("Nora error contract — message-key parity", () => {
  it.each(Object.values(NORA_ERROR_CODES))(
    "%s resolves to a human text in every CRM catalog",
    (code) => {
      const { messageKey } = NORA_ERROR_DEFINITIONS[code];
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        const text = resolve(catalog, messageKey);
        expect(typeof text, `${locale}: ${messageKey}`).toBe("string");
        expect((text as string).trim().length).toBeGreaterThan(0);
        // presentation never carries a machine code or a storage identity
        expect(text).not.toMatch(/NORA_|storage_key|SQLSTATE/);
      }
    },
  );
});

describe("W8-C S3B machine-code parity — database DETAIL = NoraErrorCode", () => {
  it("the S3A admission guard raises NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION", () => {
    expect(s3aMigration).toContain(
      `detail = '${NORA_ERROR_CODES.ATTACHMENT_STORAGE_KEY_PENDING_DELETION}'`,
    );
  });

  it("the S3B projection raises NORA_ATTACHMENT_REFERENCE_INVALID for every grammar rejection", () => {
    // element grammar, one-dimensional array, repeated key, changed metadata
    expect(
      s3bMigration.split(
        `detail = '${NORA_ERROR_CODES.ATTACHMENT_REFERENCE_INVALID}'`,
      ).length - 1,
    ).toBe(4);
  });
});
