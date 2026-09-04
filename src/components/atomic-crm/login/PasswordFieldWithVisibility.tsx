import { useState, type ReactNode } from "react";
import { FieldTitle, useInput } from "ra-core";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  FormControl,
  FormError,
  FormField,
  FormLabel,
} from "@/components/admin/form";
import { InputHelperText } from "@/components/admin/input-helper-text";

interface PasswordFieldWithVisibilityProps {
  label: string;
  source: string;
  autoComplete?: string;
  validate?: Parameters<typeof useInput>[0]["validate"];
  helperText?: string;
  /** Rendered below the field in the helper slot, e.g. a match confirmation. */
  status?: ReactNode;
}

/**
 * Password field with a show/hide toggle (V1A behaviour, V1B treatment).
 *
 * Each instance owns its visibility, so the password and its confirmation
 * never share a reveal state. The toggle is a full 44 px target inside the
 * field, `type="button"` so it can never submit, and it changes only the
 * input type — the box of the field is untouched, so toggling cannot shift
 * the layout.
 */
export const PasswordFieldWithVisibility = ({
  label,
  source,
  autoComplete,
  validate,
  helperText,
  status,
}: PasswordFieldWithVisibilityProps) => {
  const [visible, setVisible] = useState(false);
  const { id, field, isRequired } = useInput({ source, validate });

  return (
    <FormField id={id} name={field.name}>
      <FormLabel>
        <FieldTitle label={label} source={source} isRequired={isRequired} />
      </FormLabel>
      <div className="nora-access-password-field">
        <FormControl>
          <Input
            {...field}
            type={visible ? "text" : "password"}
            autoComplete={autoComplete}
          />
        </FormControl>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Passwort ausblenden" : "Passwort anzeigen"}
          aria-pressed={visible}
          className="nora-access-password-toggle"
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      <InputHelperText helperText={helperText} />
      {status}
      <FormError />
    </FormField>
  );
};
