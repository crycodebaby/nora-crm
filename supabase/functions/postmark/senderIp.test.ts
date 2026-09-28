// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  clientIpFromChain,
  isAuthorizedSenderIp,
  parseAuthorizedIps,
} from "./senderIp";

const ALLOWED = "3.134.147.250, 50.31.156.6, 50.31.156.77";
const POSTMARK = "3.134.147.250";
const ATTACKER = "203.0.113.9";

describe("clientIpFromChain", () => {
  it("takes the first entry, as Supabase's own documentation does", () => {
    expect(clientIpFromChain(`${POSTMARK}, 10.0.0.1, 10.0.0.2`)).toBe(POSTMARK);
  });

  it("trims whitespace", () => {
    expect(clientIpFromChain(`  ${POSTMARK}  , 10.0.0.1`)).toBe(POSTMARK);
  });

  it("returns null for a missing, empty or whitespace-only header", () => {
    expect(clientIpFromChain(null)).toBeNull();
    expect(clientIpFromChain(undefined)).toBeNull();
    expect(clientIpFromChain("")).toBeNull();
    expect(clientIpFromChain("   ")).toBeNull();
    expect(clientIpFromChain(" , 10.0.0.1")).toBeNull();
  });
});

describe("parseAuthorizedIps", () => {
  it("splits, trims and drops empties", () => {
    expect(parseAuthorizedIps(" a , b ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseAuthorizedIps(null)).toEqual([]);
  });
});

describe("isAuthorizedSenderIp", () => {
  it("accepts a request whose client-IP position is allowlisted", () => {
    expect(isAuthorizedSenderIp(POSTMARK, ALLOWED)).toBe(true);
    expect(isAuthorizedSenderIp(`${POSTMARK}, 10.0.0.1`, ALLOWED)).toBe(true);
  });

  it("rejects an unlisted sender", () => {
    expect(isAuthorizedSenderIp(ATTACKER, ALLOWED)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedSenderIp(null, ALLOWED)).toBe(false);
  });

  /**
   * The regression this replaces. The old check was
   * `ips.some((ip) => authorizedIPs.includes(ip))`, so simply carrying a
   * published Postmark address anywhere in the chain made an arbitrary caller
   * look like Postmark. Only the documented client-IP position counts now.
   */
  it.each([
    ["appended after the attacker's own address", `${ATTACKER}, ${POSTMARK}`],
    ["buried in the middle", `${ATTACKER}, ${POSTMARK}, 10.0.0.1`],
    ["at the end of a long chain", `${ATTACKER}, 10.0.0.1, ${POSTMARK}`],
  ])("does not accept an allowlisted address %s", (_label, chain) => {
    expect(isAuthorizedSenderIp(chain, ALLOWED)).toBe(false);
  });

  /**
   * Honesty check, not a guarantee: a caller CAN still put an allowlisted
   * address in the first position, because `x-forwarded-for` is caller-supplied
   * and Supabase attests no position in the chain. This test records that the
   * filter is knowingly spoofable, which is exactly why the Basic-auth secret
   * is checked first and is the only real gate.
   */
  it("is knowingly spoofable when the caller controls the leading entry", () => {
    expect(isAuthorizedSenderIp(`${POSTMARK}, ${ATTACKER}`, ALLOWED)).toBe(
      true,
    );
  });
});
