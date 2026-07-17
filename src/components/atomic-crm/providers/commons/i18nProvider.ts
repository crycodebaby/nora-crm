import { mergeTranslations } from "ra-core";
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import frenchMessages from "ra-language-french";
import germanMessages from "ra-language-german";
import { raSupabaseEnglishMessages } from "ra-supabase-language-english";
import { raSupabaseFrenchMessages } from "ra-supabase-language-french";
import { englishCrmMessages } from "./englishCrmMessages";
import { frenchCrmMessages } from "./frenchCrmMessages";
import { germanCrmMessages } from "./germanCrmMessages";

const raSupabaseEnglishMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset: "Check your emails for a Reset Password message.",
    },
  },
};

const raSupabaseFrenchMessagesOverride = {
  "ra-supabase": {
    auth: {
      password_reset:
        "Consultez vos emails pour trouver le message de reinitialisation du mot de passe.",
    },
  },
};

const raSupabaseGermanMessagesOverride = {
  "ra-supabase": {
    auth: {
      email: "E-Mail",
      confirm_password: "Passwort bestätigen",
      sign_in_with: "Mit %{provider} anmelden",
      forgot_password: "Passwort vergessen?",
      reset_password: "Passwort zurücksetzen",
      password_reset:
        "Prüfen Sie Ihre E-Mails auf eine Nachricht zum Zurücksetzen des Passworts.",
      missing_tokens: "Zugriffs- und Aktualisierungstoken fehlen",
      back_to_login: "Zurück zur Anmeldung",
    },
    reset_password: {
      forgot_password: "Passwort vergessen?",
      forgot_password_details:
        "Geben Sie Ihre E-Mail-Adresse ein, um Anweisungen zu erhalten.",
    },
    set_password: {
      new_password: "Passwort festlegen",
    },
    validation: {
      password_mismatch: "Passwörter stimmen nicht überein",
    },
  },
};

/** Overrides for react-admin v5 keys missing from ra-language-german v3 */
const germanRaMessagesOverride = {
  ra: {
    page: {
      dashboard: "Übersicht",
      access_denied: "Sie haben keine Berechtigung für diese Seite",
      authentication_error:
        "Der Authentifizierungsserver hat einen Fehler zurückgegeben.",
      invite: "Möchten Sie einen Eintrag anlegen?",
      loading: "Wird geladen",
    },
    action: {
      add: "Hinzufügen",
      add_filter: "Filter hinzufügen",
      back: "Zurück",
      bulk_actions:
        "1 Eintrag ausgewählt |||| %{smart_count} Einträge ausgewählt",
      cancel: "Abbrechen",
      clear_array_input: "Liste wirklich leeren?",
      clear_input_value: "Eingabe löschen",
      clone: "Duplizieren",
      close: "Schließen",
      close_menu: "Menü schließen",
      confirm: "Bestätigen",
      create: "Anlegen",
      create_item: "%{item} anlegen",
      delete: "Löschen",
      edit: "Bearbeiten",
      export: "Daten herunterladen",
      expand: "Erweitern",
      list: "Liste",
      move_down: "Nach unten",
      move_up: "Nach oben",
      open: "Öffnen",
      open_menu: "Menü öffnen",
      refresh: "Aktualisieren",
      remove: "Entfernen",
      remove_all_filters: "Alle Filter entfernen",
      remove_filter: "Filter entfernen",
      reset: "Zurücksetzen",
      save: "Speichern",
      search: "Suchen",
      search_columns: "Spalten durchsuchen",
      select_all: "Alle auswählen",
      select_all_button: "Alle auswählen",
      select_columns: "Spalten",
      select_row: "Diese Zeile auswählen",
      show: "Anzeigen",
      sort: "Sortieren",
      toggle_theme: "Hell-/Dunkelmodus umschalten",
      undo: "Rückgängig",
      unselect: "Auswahl aufheben",
      update: "Aktualisieren",
      update_application: "Anwendung neu laden",
    },
    auth: {
      auth_check_error: "Bitte melden Sie sich an, um fortzufahren",
      email: "E-Mail",
      logout: "Abmelden",
      password: "Passwort",
      sign_in: "Anmelden",
      sign_in_error: "Anmeldung fehlgeschlagen. Bitte erneut versuchen",
      user_menu: "Profil",
      username: "Benutzername",
    },
    boolean: {
      false: "Nein",
      null: " ",
      true: "Ja",
    },
    message: {
      about: "Über",
      access_denied: "Sie haben keine Berechtigung für diese Seite",
      are_you_sure: "Sind Sie sicher?",
      authentication_error: "Die Anmeldedaten konnten nicht überprüft werden.",
      auth_error: "Beim Prüfen des Anmeldetokens ist ein Fehler aufgetreten.",
      bulk_delete_content:
        'Möchten Sie „%{name}" wirklich löschen? |||| Möchten Sie diese %{smart_count} Einträge wirklich löschen?',
      bulk_delete_title: "%{name} löschen |||| %{smart_count} %{name} löschen",
      bulk_update_content:
        "Möchten Sie %{name} %{recordRepresentation} wirklich aktualisieren? |||| Möchten Sie diese %{smart_count} Einträge wirklich aktualisieren?",
      bulk_update_title:
        "%{name} %{recordRepresentation} aktualisieren |||| %{smart_count} %{name} aktualisieren",
      delete_content: 'Möchten Sie „%{name}" wirklich löschen?',
      delete_title: "%{name} %{recordRepresentation} löschen",
      details: "Details",
      error:
        "Ein Fehler ist aufgetreten. Ihre Anfrage konnte nicht abgeschlossen werden.",
      invalid_form:
        "Das Formular ist ungültig. Bitte prüfen Sie Ihre Eingaben.",
      loading: "Bitte warten",
      no: "Nein",
      not_found:
        "Die Seite wurde nicht gefunden. Prüfen Sie die Adresse oder den Link.",
      placeholder_data_warning:
        "Netzwerkproblem: Daten konnten nicht aktualisiert werden.",
      select_all_limit_reached:
        "Es sind zu viele Einträge für eine Gesamtauswahl. Nur die ersten %{max} wurden ausgewählt.",
      unsaved_changes:
        "Einige Änderungen wurden nicht gespeichert. Seite wirklich verlassen?",
      yes: "Ja",
    },
    navigation: {
      clear_filters: "Filter zurücksetzen",
      current_page: "Seite %{page}",
      first: "Zur ersten Seite",
      last: "Zur letzten Seite",
      next: "Nächste Seite",
      no_filtered_results: "Keine %{name} mit den aktuellen Filtern gefunden.",
      no_more_results:
        "Die Seitenzahl %{page} liegt außerhalb des gültigen Bereichs.",
      no_results: "Keine %{name} gefunden",
      page: "Zu Seite %{page}",
      page_out_from_begin: "Vor Seite 1 nicht möglich",
      page_out_from_end: "Nach der letzten Seite nicht möglich",
      page_out_of_boundaries: "Seitenzahl %{page} außerhalb des Bereichs",
      page_range_info: "%{offsetBegin}–%{offsetEnd} von %{total}",
      page_rows_per_page: "Zeilen pro Seite:",
      partial_page_range_info:
        "%{offsetBegin}–%{offsetEnd} von mehr als %{offsetEnd}",
      previous: "Vorherige Seite",
      skip_nav: "Zum Inhalt springen",
    },
    notification: {
      application_update_available: "Eine neue Version ist verfügbar.",
      bad_item: "Ungültiger Eintrag",
      canceled: "Aktion abgebrochen",
      created: "Eintrag angelegt",
      data_provider_error:
        "Datenanbieter-Fehler. Details finden Sie in der Konsole.",
      deleted: "Eintrag gelöscht |||| %{smart_count} Einträge gelöscht",
      http_error: "Kommunikationsfehler mit dem Server",
      i18n_error:
        "Übersetzungen für die gewählte Sprache konnten nicht geladen werden.",
      item_doesnt_exist: "Der Eintrag existiert nicht",
      logged_out:
        "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
      not_authorized:
        "Sie sind nicht berechtigt, auf diese Ressource zuzugreifen.",
      offline: "Keine Verbindung. Daten konnten nicht geladen werden.",
      updated: "Eintrag aktualisiert |||| %{smart_count} Einträge aktualisiert",
    },
    sort: {
      ASC: "aufsteigend",
      DESC: "absteigend",
      sort_by: "Sortieren nach %{field_lower_first} %{order}",
    },
    validation: {
      email: "Muss eine gültige E-Mail-Adresse sein",
      maxLength: "Darf höchstens %{max} Zeichen lang sein",
      maxValue: "Darf höchstens %{max} sein",
      minLength: "Muss mindestens %{min} Zeichen lang sein",
      minValue: "Muss mindestens %{min} sein",
      number: "Muss eine Zahl sein",
      oneOf: "Muss einer der folgenden Werte sein: %{options}",
      regex: "Muss dem Format entsprechen: %{pattern}",
      required: "Pflichtfeld",
      unique: "Muss eindeutig sein",
    },
    saved_queries: {
      help: "Liste filtern und diese Abfrage für später speichern",
      label: "Gespeicherte Abfragen",
      new_dialog_title: "Aktuelle Abfrage speichern als",
      new_label: "Aktuelle Abfrage speichern…",
      query_name: "Name der Abfrage",
      remove_dialog_title: "Gespeicherte Abfrage entfernen?",
      remove_label: "Gespeicherte Abfrage entfernen",
      remove_label_with_name: 'Abfrage „%{name}" entfernen',
      remove_message:
        "Möchten Sie diesen Eintrag wirklich aus Ihren gespeicherten Abfragen entfernen?",
    },
  },
};

const englishCatalog = mergeTranslations(
  englishMessages,
  raSupabaseEnglishMessages,
  raSupabaseEnglishMessagesOverride,
  englishCrmMessages,
);

const frenchCatalog = mergeTranslations(
  englishCatalog,
  frenchMessages,
  raSupabaseFrenchMessages,
  raSupabaseFrenchMessagesOverride,
  frenchCrmMessages,
);

const germanCatalog = mergeTranslations(
  englishCatalog,
  germanMessages,
  raSupabaseGermanMessagesOverride,
  germanRaMessagesOverride,
  germanCrmMessages,
);

export const getInitialLocale = (): "de" | "en" | "fr" => {
  if (typeof navigator === "undefined") {
    return "de";
  }

  const browserLocale = navigator.languages?.[0] ?? navigator.language;
  const lower = browserLocale?.toLowerCase() ?? "";
  if (lower.startsWith("fr")) {
    return "fr";
  }
  if (lower.startsWith("en")) {
    return "en";
  }

  return "de";
};

export const i18nProvider = polyglotI18nProvider(
  (locale) => {
    if (locale === "fr") {
      return frenchCatalog;
    }
    if (locale === "de") {
      return germanCatalog;
    }
    return englishCatalog;
  },
  getInitialLocale(),
  [
    { locale: "de", name: "Deutsch" },
    { locale: "en", name: "English" },
    { locale: "fr", name: "Français" },
  ],
  { allowMissing: true },
);

export const testI18nProvider = polyglotI18nProvider(
  () => englishCatalog,
  "en",
  [{ locale: "en", name: "English" }],
  { allowMissing: true },
);
