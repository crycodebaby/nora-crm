import { useInput } from "ra-core";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError, FormField } from "@/components/admin/form";

/**
 * The personal-use confirmation on the password step (V1B).
 *
 * A checkbox, not the settings-style Switch: the employee confirms a
 * sentence, they do not toggle a preference. The whole row is a 44 px target
 * and the label is clickable. Validation stays in the form (`validate` on the
 * page), so this component carries no rule of its own.
 */
export const ConsentCheckbox = ({
  source,
  label,
}: {
  source: string;
  label: string;
}) => {
  const { id, field } = useInput({ source, defaultValue: false });
  const checked = Boolean(field.value);

  return (
    <FormField id={id} name={field.name}>
      <div className="nora-access-consent">
        <Checkbox
          id={id}
          name={field.name}
          checked={checked}
          onCheckedChange={(value) => field.onChange(value === true)}
          onBlur={field.onBlur}
          aria-describedby={`${id}-consent-text`}
        />
        <label
          htmlFor={id}
          id={`${id}-consent-text`}
          className="nora-access-consent-label"
        >
          {label}
        </label>
      </div>
      <FormError />
    </FormField>
  );
};
