import { internet, name } from "faker/locale/en_US";

import type { Sale } from "../../../types";
import type { Db } from "./types";

export const generateSales = (_: Db): Sale[] => {
  const demoUsers: Sale[] = [
    {
      id: 0,
      user_id: "0",
      first_name: "Anna",
      last_name: "Admin",
      email: "admin@nora.demo",
      password: "demo",
      administrator: true,
      role: "admin" as const,
      disabled: false,
    },
    {
      id: 1,
      user_id: "1",
      first_name: "Otto",
      last_name: "Office",
      email: "office@nora.demo",
      password: "demo",
      administrator: false,
      role: "office" as const,
      disabled: false,
    },
    {
      id: 2,
      user_id: "2",
      first_name: "Vera",
      last_name: "Viewer",
      email: "viewer@nora.demo",
      password: "demo",
      administrator: false,
      role: "viewer" as const,
      disabled: false,
    },
  ];

  const randomSales = Array.from(Array(3).keys()).map((id) => {
    const first_name = name.firstName();
    const last_name = name.lastName();
    const email = internet.email(first_name, last_name);

    return {
      id: id + 3,
      user_id: `${id + 3}`,
      first_name,
      last_name,
      email,
      password: "demo",
      administrator: false,
      role: "viewer" as const,
      disabled: false,
    };
  });

  return [...demoUsers, ...randomSales];
};
