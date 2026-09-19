import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  ATTACHMENT_MAX_FILE_SIZE_BYTES,
  assertStoredAttachment,
  createAttachmentObjectKey,
  getAttachmentFileRejection,
} from "./attachments";
import {
  NORA_ERROR_CODES,
  extractNoraErrorCode,
} from "../../domain/noraErrorCodes";
import { normalizeCrmError } from "../../misc/normalizeCrmError";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attachment upload policy", () => {
  it("mirrors the bucket allowlist of migration 20260915120000", () => {
    expect(Object.keys(ATTACHMENT_ACCEPT).sort()).toEqual(
      [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/webp",
        "text/csv",
        "text/plain",
      ].sort(),
    );
    expect(ATTACHMENT_MAX_FILE_SIZE_BYTES).toBe(52428800);
  });

  it.each(Object.keys(ATTACHMENT_ACCEPT))("accepts %s", (type) => {
    expect(getAttachmentFileRejection({ type, size: 1 })).toBeNull();
  });

  it.each([
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
    "application/javascript",
    "text/javascript",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "image/heic",
    "application/octet-stream",
    "",
  ])("rejects type %j", (type) => {
    expect(getAttachmentFileRejection({ type, size: 1 })).toBe("file_type");
  });

  it("rejects inherited object keys as MIME types", () => {
    expect(getAttachmentFileRejection({ type: "constructor", size: 1 })).toBe(
      "file_type",
    );
  });

  it("enforces the size limit inclusively", () => {
    const type = "application/pdf";
    expect(
      getAttachmentFileRejection({
        type,
        size: ATTACHMENT_MAX_FILE_SIZE_BYTES,
      }),
    ).toBeNull();
    expect(
      getAttachmentFileRejection({
        type,
        size: ATTACHMENT_MAX_FILE_SIZE_BYTES + 1,
      }),
    ).toBe("file_size");
  });

  it("exposes no active content types in the input accept attribute", () => {
    const tokens = ATTACHMENT_ACCEPT_ATTRIBUTE.split(",");
    expect(tokens).toContain("application/pdf");
    expect(tokens).toContain(".docx");
    for (const token of tokens) {
      expect(token).not.toMatch(
        /svg|html|^text\/xml|^application\/xml|javascript|^\.js$/,
      );
    }
  });
});

describe("createAttachmentObjectKey", () => {
  it("uses a CSPRNG UUID and never Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const key = createAttachmentObjectKey("Angebot.pdf");

    expect(key).toMatch(new RegExp(`${UUID.source}\\.pdf$`));
    expect(random).not.toHaveBeenCalled();
  });

  it("creates distinct keys for the same file name", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => createAttachmentObjectKey("a.png")),
    );
    expect(keys.size).toBe(50);
  });

  it("keeps the current flat key shape with a normalized extension", () => {
    expect(createAttachmentObjectKey("Foto.JPEG")).toMatch(
      new RegExp(`${UUID.source}\\.jpeg$`),
    );
    expect(createAttachmentObjectKey("archiv.tar.gz")).toMatch(/\.gz$/);
    expect(createAttachmentObjectKey("ohne-endung")).toMatch(
      new RegExp(`${UUID.source}$`),
    );
    expect(createAttachmentObjectKey("")).toMatch(
      new RegExp(`${UUID.source}$`),
    );
    expect(createAttachmentObjectKey("evil.p?h/p")).toMatch(
      new RegExp(`${UUID.source}$`),
    );
    expect(createAttachmentObjectKey("x.<script>")).toMatch(
      new RegExp(`${UUID.source}$`),
    );
    expect(createAttachmentObjectKey("x.abcdefghijklmnop")).toMatch(
      new RegExp(`${UUID.source}$`),
    );
  });

  it("takes the extension from the last path segment (logo re-crop passes the old URL as name)", () => {
    const key = createAttachmentObjectKey(
      "http://127.0.0.1:54321/storage/v1/object/public/attachments/0.8262106278726917.png",
    );
    expect(key).toMatch(new RegExp(`${UUID.source}\\.png$`));
    expect(key).not.toContain("/");
  });
});

describe("assertStoredAttachment (W8-C S3B)", () => {
  it("keeps an element that already is a Nora storage object", () => {
    expect(() =>
      assertStoredAttachment({ path: "0.8262106278726917.pdf" }),
    ).not.toThrow();
  });

  it.each([undefined, null, ""])(
    "rejects an element without a storage key (%s) with NORA_ATTACHMENT_REFERENCE_INVALID",
    (path) => {
      let caught: unknown;
      try {
        assertStoredAttachment({ path });
      } catch (error) {
        caught = error;
      }
      expect(extractNoraErrorCode(caught)).toBe(
        NORA_ERROR_CODES.ATTACHMENT_REFERENCE_INVALID,
      );
      expect(normalizeCrmError(caught).messageKey).toBe(
        "crm.errors.attachment_reference_invalid",
      );
    },
  );
});
