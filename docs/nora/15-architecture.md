# 15 – Architektur: Ist-Zustand und Richtung

Status: CURRENT · Zweck: ARCHITEKTUR-REFERENZ · Authority: NORMATIV für neue Schreibpfade und Schnittstellen · Zuletzt geprüft: 2026-09-04

Dieses Dokument beschreibt, was im Code tatsächlich existiert, und trennt das ausdrücklich von der Zielrichtung. Sicherheits- und Datenmodell-Regeln stehen vollständig in `03-data-model-guardrails.md`; hier nur Verweise.

## 1. Ist-Zustand in einem Bild

```
Interfaces / Delivery      React-UI (ra-core, shadcn), src/components/atomic-crm/<resource>/*
        ↓
Application Layer          application/commands/*  (2 Commands) + operations/execute*.ts (Wrapper je Catalog-Operation)
        ↓
Domain Rules               domain/*  (framework-frei; Effective-Contact-Regel, Error Codes)
        ↓
Execution / Infrastructure operations/* (OperationManager, Catalog, Korrelation, Error Observatory)
                           providers/supabase/* | providers/fakerest/*  (DataProvider, AuthProvider)
        ↓
Supabase / PostgreSQL      RLS, SECURITY-DEFINER-RPCs, Trigger, audit_events, operation_errors, idempotency_records
```

Reifegrad, ehrlich: Die Schichten sind **additiv und punktuell**, keine durchgängige Clean-/Hexagonal-Architektur. Der Großteil der CRUD-Flows (Listen, Show, Edit, Notizen, Aufgaben, Kanban-Drop) läuft direkt UI → ra-core-DataProvider → PostgREST. Nur die atomaren Schreibpfade der letzten Wellen sind als Commands modelliert.

## 2. Schichten und Verzeichnisse

| Schicht | Verzeichnis (unter `src/components/atomic-crm/`) | Was dort liegt | Reifegrad |
|---|---|---|---|
| Delivery / UI | `companies/`, `contacts/`, `deals/`, `tasks/`, `notes/`, `dashboard/`, `quickCapture/`, `layout/`, `login/`, `settings/`, `audit/`, `calendar/`, `checklists/` | Seiten, Formulare, Dialoge; Rollen-Guards (`NoraAccessGuard`, `CanAccess`) | vollständig |
| Application Commands | `application/commands/createQuickCaptureCase.ts`, `application/commands/createCustomerFromContact.ts` | Fachlicher Intent als Funktion; ruft DataProvider-Methoden; kennt keine Presentation | **zwei Commands**, Muster etabliert |
| Domain | `domain/customerContactContext.ts`, `domain/noraErrorCodes.ts`, `domain/effectiveContactContext.contractCases.ts` | Reine Regeln und Codes ohne React/Supabase | klein, aber verbindlich |
| Execution / Korrelation | `operations/operationManager.ts`, `operationCatalog.ts`, `operationContext.ts`, `operationTransport.ts`, `execute*.ts`, `errorObservatory.ts`, `rpcDisposition.ts` | Operation-Lifecycle `pending → success \| error`, `operation_id`-Header, Disposition `executed \| replayed`, best-effort Fehlerpersistenz | vollständig für die migrierten Operationen |
| Presentation-Schichten | `notifications/*` (Statusmeldungen), `pwa/*` (Update-Fläche) | Reduzieren Operation-/Browser-Fakten auf Anzeige; schreiben nie in den Core zurück | Notification nur für Quick Capture; PWA vollständig |
| Provider | `providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`, `providers/commons/canAccess.ts`, `providers/commons/i18nProvider.ts` | Datenzugriff, Auth, UI-Rollenspiegel, Sprachkataloge | vollständig; FakeRest ohne Datenautorisierung |
| Datenbank | `supabase/migrations/*`, `supabase/schemas/01…07_*.sql`, `supabase/tests/*.sql` | Schema, `nora_private`-Helper, RPCs, Trigger, RLS, SQL-Verifikation | autoritativ |

Operation Catalog heute: `deal.update`, `deal.assign`, `customer.update`, `contact.update`, `customer.createWithContact`, `contact.setPrimary`, `contact.convertToCustomer`, `quickCapture.createCase`, `quickCapture.createTask`. Nicht jede Catalog-Operation hat einen Command; `deal.update` z. B. ist ein DataProvider-Wrapper.

## 3. Anwendungsoperationen (Application Commands)

Prinzip: Ein fachlicher Schreibvorgang wird durch seine Absicht benannt (`createQuickCaptureCase`, `createCustomerFromContact`), nicht durch Tabellen-CRUD. Der Command

- nimmt neutrale Eingaben und optionale Execution-Metadaten (`operationIds`, `idempotencyKey`) entgegen,
- ruft eine serverseitige RPC, die in **einer Transaktion** schreibt und selbst autorisiert (`nora_private.can_write()`),
- gibt Ergebnis-Referenzen (IDs) zurück und wirft normalisierte Fehler (`normalizeCrmError`, `NoraErrorCode`),
- importiert **nichts** aus `notifications/` oder anderen Presentation-Schichten.

Aktueller Stand: Nur Schnellerfassung und „Kontakt → Kundenakte" laufen so. `/kunden/create` ruft `dataProvider.createCustomerWithContact()` direkt (RPC, aber ohne Command-Datei und ohne Idempotency-Key). Normale Edits laufen über ra-core. Neue **atomare oder externe** Schreibpfade folgen dem Command-Muster; bestehende Flows werden nicht vorsorglich umgebaut.

## 4. Domain-Regeln

- `domain/customerContactContext.ts` ist die einzige TS-Implementierung von „gehört dieser Kontakt zu dieser Kundenakte" (`contact.company_id = company.id` **oder** `company.self_contact_id = contact.id`). Die SQL-Autorität ist `nora_private.is_effective_contact_of_company()`; FakeRest spiegelt sie in `providers/fakerest/internal/taskContextCheck.ts`. Alle drei müssen mit der Szenario-Matrix `effectiveContactContext.contractCases.ts` übereinstimmen (`03`, Falle 31).
- `domain/noraErrorCodes.ts` definiert die stabilen Business-Fehlercodes; der Server liefert sie als `DETAIL = 'NORA_<CODE>'` (`03`, Falle 33).
- Domain-Regeln bleiben React-frei und Supabase-frei, damit sie in Unit-Tests und in beiden Providern gleich gelten. Nora hat **keinen** isolierten DDD-Kern; Invarianten leben primär in der Datenbank (Constraints, Trigger, RPC-Körper) und werden im TS-Domain-Modul nur gespiegelt, wo die UI sie vor dem Roundtrip braucht.

## 5. `operations/` — Execution- und Korrelationsgrenze

`operations/` ist Noras Infrastruktur-Grenze für fachliche Operationen. Es ist **kein** abstrakter Port-Layer und soll keiner werden:

- `OperationManager` (prozessweiter Singleton, auch ohne React) führt Handler aus und hält In-Memory-Records `pending | success | error` mit `execution?: executed | replayed`, `errorCode`, `result` (Operation Status Contract v1).
- `operation_id` (Header `x-nora-operation-id`) ist technische Korrelation bis `audit_events.request_id` und `operation_errors.operation_id`. Sie ist nie Auth und nie Geschäftslogik.
- `idempotency_key` (RPC-Parameter) ist die fachliche Retry-Absicht; serverseitig in `nora_private.idempotency_records`. `operation_id ≠ idempotency_key`, beide unabhängig.
- Error Observatory (`operation_errors`, RPCs `record_operation_error` / `report_operation_error`) speichert technische Fehlschläge getrennt vom Audit; Ausfall der Observatory ersetzt nie den Business-Fehler.
- Keine abstrakten Repositories oder Ports „für einen zweiten Adapter" anlegen. Der zweite Adapter ist FakeRest, und er läuft über dieselben DataProvider-Methoden mit Paritätspflicht.

Die vier Konzepte bleiben getrennt: **Operation Status** (kurzlebige technische Wahrheit, in-memory) · **Audit** (dauerhafte fachliche Historie, `audit_events`) · **Error Observatory** (dauerhafte technische Fehlerinformation, `operation_errors`) · **Notification** (menschliche Darstellung, `notifications/`). Presentation erfindet keinen Core-Lifecycle (`03`, Falle 37).

## 6. Daten und Sicherheit

Supabase/PostgreSQL ist autoritativ für persistente Daten, Transaktionen, RLS, serverseitige Autorisierung, Integritätsbedingungen, Nummernvergabe und Audit. Frontend-Berechtigungen (`canAccess.ts`, `NoraAccessGuard`) sind Komfort, keine Sicherheitsgrenze. Interne Helper liegen im Schema `nora_private` und sind nicht über PostgREST erreichbar. Vollständige Guardrails, Fallen und die Advisor-Bewertung: `03-data-model-guardrails.md`.

Betriebsfakten, die Entwürfe beeinflussen: Nora ist eine PWA mit wartendem Service Worker (`registerType: "prompt"`); Vercel liefert `/assets/*` ohne `immutable`, deshalb muss der Precache des laufenden Builds intakt bleiben (Regeln in `07`). Vercel baut jeden Push auf `main` automatisch; Edge Functions werden separat und manuell deployed (Stand in `16`).

## 7. Zwei Provider, eine Semantik

Supabase (Produktion) und FakeRest (`npm run dev:demo`) müssen für jeden migrierten Flow dieselbe Fachsemantik zeigen: gleiche Error Codes (`throwNoraError()`), gleiche Idempotency-Disposition, gleiche Effective-Contact-Regel. Bekannte, akzeptierte Lücke: FakeRest hat keine `can_write()`-Entsprechung; Autorisierung wird dort nur über die UI simuliert. RBAC ist deshalb ausschließlich gegen echtes Supabase testbar (`supabase/tests/rbac_rls_*.sql`).

## 8. Bewusst nicht vorhanden

Nora nutzt **nicht** und behauptet **nicht**:

- vollständige Clean Architecture oder strikte Hexagonal Architecture
- CQRS-Framework, eigene Query-/Read-Model-Schicht
- Event Bus, Domain Events, Outbox, Queues, Worker
- Microservices, eigener Backend-Server (es gibt nur Supabase)
- generisches Repository- oder Command-Framework
- generische KI-Orchestrierung oder MCP-Architektur
- serverseitige Drafts, Realtime-Kollaboration

Diese werden nur eingeführt, wenn eine konkrete Anforderung sie erzwingt und eine Entscheidung in `06` steht.

## 9. Zielrichtung (kein Bauauftrag)

```
UI heute · künftige API · künftige Automatisierung · mögliche KI-/MCP-Clients
        ↓
stabile Nora-Anwendungsoperationen (benannt nach Absicht, autorisiert, idempotent, korreliert)
        ↓
Domain-Regeln
        ↓
Infrastruktur (Supabase)
```

Regeln, die heute schon gelten:

- Externe Clients erhalten **nie** direkten SQL- oder Tabellenzugriff. Sie rufen kontrollierte Anwendungsoperationen mit den bestehenden Autorisierungs- und Fachregeln (`03`, Falle 36).
- Lesende Auswertungen für Automatisierung oder KI gehen über anwendungsseitige Read-Models (konzeptionell, nicht implementiert), nie über roh generiertes SQL gegen `audit_events` oder andere Tabellen.
- Neue Commands werden nur für konkrete Flows gebaut, nicht vorsorglich für „die API".

Diese Richtung ist **keine Freigabe** für eine API-, Automatisierungs- oder KI-Welle.

## 10. Geerbter MCP-Server (Upstream-Falle)

Der Code enthält einen von Atomic CRM geerbten MCP-Server (`supabase/functions/mcp`, Eintrag `[functions.mcp]` in `supabase/config.toml`, Upstream-Anleitung in `doc/`). Er führt parser-geprüftes **Roh-SQL** (SELECT/INSERT/UPDATE/DELETE) im Namen des angemeldeten Benutzers aus. `ProfilePage.tsx` und `SettingsPageMobile.tsx` zeigen einen Abschnitt „MCP Server" mit dieser URL.

Stand: Die Function ist in Produktion **nicht deployed**; der angezeigte Link führt ins Leere. Bewertung:

- Es ist Upstream-Code, nicht Noras KI-Architektur und keine freigegebene Nora-Integration.
- Er widerspricht Abschnitt 9 (direkter SQL-Zugang für externe Clients).
- Er wird **nicht** deployed und **nicht** erweitert, nur weil er existiert.
- Entscheidung des Product Owners: ChatGPT/Nora-Integration ist **PARKED / MAYBE**. Es gibt keine freigegebene Implementierungswelle. Ob der Profil-Abschnitt ausgeblendet wird, ist eine offene PO-Entscheidung (`17`).

## 11. Wo weiterlesen

| Thema | Dokument |
|---|---|
| Guardrails, Fallen, RLS/SECURITY DEFINER, Error Contract | `03-data-model-guardrails.md` |
| Domänenmodell | `01-domain-model.md` |
| Notification- und PWA-Presentation-Verträge | `02-design-system.md` |
| Checklisten, Migration, Testreihenfolgen, Release-Vokabular | `07-agent-change-checklist.md` |
| Begründungen (Self Contact, Idempotency, Operation Status, Notification 7A, Error Contract) | `06-decision-log.md` |
| Was ist live | `16-current-state.md` |
