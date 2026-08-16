import type { Contact, EmailAndType } from "../../types";
import { getContactAvatar, hash } from "./getContactAvatar";

describe("getContactAvatar", () => {
  const originalFetch = globalThis.fetch;
  let responses: Map<string, boolean>;

  beforeEach(() => {
    responses = new Map();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (!responses.has(url)) {
        throw new Error(
          `getContactAvatar.test.ts: unexpected fetch call to "${url}" — no stub registered, real network access is not allowed in this test`,
        );
      }
      return { ok: responses.get(url) } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should return gravatar URL for anthony@marmelab.com", async () => {
    const email: EmailAndType[] = [
      { email: "anthony@marmelab.com", type: "Work" },
    ];
    const hashedEmail = await hash(email[0].email);
    const gravatarUrl = `https://www.gravatar.com/avatar/${hashedEmail}?d=404`;
    responses.set(gravatarUrl, true);
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBe(gravatarUrl);
  });

  it("should return favicon URL if gravatar does not exist", async () => {
    const email: EmailAndType[] = [
      { email: "no-gravatar@gravatar.com", type: "Work" },
    ];
    const hashedEmail = await hash(email[0].email);
    responses.set(
      `https://www.gravatar.com/avatar/${hashedEmail}?d=404`,
      false,
    );
    responses.set("https://gravatar.com/favicon.ico", true);
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBe("https://gravatar.com/favicon.ico");
  });

  it("should not return favicon URL if not domain not allowed", async () => {
    const email: EmailAndType[] = [
      { email: "no-gravatar@gmail.com", type: "Work" },
    ];
    const hashedEmail = await hash(email[0].email);
    responses.set(
      `https://www.gravatar.com/avatar/${hashedEmail}?d=404`,
      false,
    );
    // gmail.com is in DOMAINS_NOT_SUPPORTING_FAVICON — no favicon fetch expected.
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if no email is provided", async () => {
    const record: Partial<Contact> = {};

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if an empty array is provided", async () => {
    const email: EmailAndType[] = [];
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return null if email has no gravatar or validate domain", async () => {
    const email: EmailAndType[] = [
      { email: "anthony@fake-domain-marmelab.com", type: "Work" },
    ];
    const hashedEmail = await hash(email[0].email);
    responses.set(
      `https://www.gravatar.com/avatar/${hashedEmail}?d=404`,
      false,
    );
    responses.set("https://fake-domain-marmelab.com/favicon.ico", false);
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBeNull();
  });

  it("should return gravatar URL for 2nd email if 1st email has no gravatar nor valid domain", async () => {
    const email: EmailAndType[] = [
      { email: "anthony@fake-domain-marmelab.com", type: "Work" },
      { email: "anthony@marmelab.com", type: "Work" },
    ];
    const hash1 = await hash(email[0].email);
    const hash2 = await hash(email[1].email);
    const gravatarUrl2 = `https://www.gravatar.com/avatar/${hash2}?d=404`;
    responses.set(`https://www.gravatar.com/avatar/${hash1}?d=404`, false);
    responses.set("https://fake-domain-marmelab.com/favicon.ico", false);
    responses.set(gravatarUrl2, true);
    const record: Partial<Contact> = { email_jsonb: email };

    const avatarUrl = await getContactAvatar(record);
    expect(avatarUrl).toBe(gravatarUrl2);
  });
});
