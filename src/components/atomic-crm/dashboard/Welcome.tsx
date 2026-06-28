import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Welcome = () => (
  <Card>
    <CardHeader className="px-4">
      <CardTitle>Willkommen bei Nora CRM</CardTitle>
    </CardHeader>
    <CardContent className="px-4">
      <p className="text-sm mb-4">
        Nora CRM ist Ihr internes System für Kunden, Kontakte, Aufgaben und
        Vorgänge der Ergart Gruppe.
      </p>
      <p className="text-sm mb-4">
        In dieser Demo laufen die Daten im Browser und werden beim Neuladen
        zurückgesetzt. In der Produktivumgebung wird Supabase als Backend
        verwendet.
      </p>
      <p className="text-sm">
        Technische Basis:{" "}
        <a
          href="https://marmelab.com/shadcn-admin-kit"
          className="underline hover:no-underline"
        >
          shadcn-admin-kit
        </a>{" "}
        und{" "}
        <a
          href="https://github.com/marmelab/atomic-crm"
          className="underline hover:no-underline"
        >
          Atomic CRM
        </a>{" "}
        (Open Source).
      </p>
    </CardContent>
  </Card>
);
