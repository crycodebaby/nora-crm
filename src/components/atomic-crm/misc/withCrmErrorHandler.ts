import type { DataProvider } from "ra-core";

import { toCrmError } from "./normalizeCrmError";

const DATA_PROVIDER_METHODS = new Set([
  "getList",
  "getOne",
  "getMany",
  "getManyReference",
  "create",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

/** Wraps data-provider calls so thrown errors carry normalized i18n keys. */
export const withCrmErrorHandler = <T extends DataProvider>(provider: T): T =>
  new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof value !== "function" ||
        typeof prop !== "string" ||
        !DATA_PROVIDER_METHODS.has(prop)
      ) {
        return value;
      }
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } catch (error) {
          throw toCrmError(error);
        }
      };
    },
  });
