import { required, useTranslate } from "ra-core";
import { SelectInput } from "@/components/admin/select-input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { DEAL_STAGE_DEFAULT, getDealStageCssVars } from "./dealStageModel";
import { DealStagePill } from "./DealStagePill";

type DealStageSelectorProps = {
  /** When true, renders a React-Admin SelectInput for forms. */
  asInput?: boolean;
  source?: string;
  disabled?: boolean;
  className?: string;
  /** Controlled mode (non-input) */
  value?: string | null;
  onChange?: (stage: string) => void;
  validate?: Parameters<typeof SelectInput>[0]["validate"];
  defaultValue?: string;
  helperText?: false | string;
};

/**
 * Deal-only stage selector. Never uses noteStatuses.
 * Form mode: SelectInput with pill options.
 * Controlled mode: Radix Select for inline edits.
 */
export function DealStageSelector({
  asInput = true,
  source = "stage",
  disabled,
  className,
  value,
  onChange,
  validate = required(),
  defaultValue = DEAL_STAGE_DEFAULT,
  helperText = false,
}: DealStageSelectorProps) {
  const { dealStages } = useConfigurationContext();
  const translate = useTranslate();

  if (asInput) {
    return (
      <SelectInput
        source={source}
        label={translate("resources.deals.fields.stage", {
          _: "Vorgangsstatus",
        })}
        choices={dealStages}
        optionText={(choice) => (
          <DealStagePill stage={choice.value} className="max-w-full" />
        )}
        optionValue="value"
        defaultValue={defaultValue}
        helperText={helperText}
        validate={validate}
        disabled={disabled}
        className={className}
      />
    );
  }

  const current = value ?? DEAL_STAGE_DEFAULT;
  const vars = getDealStageCssVars(current);

  return (
    <Select
      disabled={disabled}
      value={current}
      onValueChange={(next) => onChange?.(next)}
    >
      <SelectTrigger
        className={cn("w-full min-w-[12rem]", className)}
        style={vars}
        aria-label={translate("resources.deals.fields.stage", {
          _: "Vorgangsstatus",
        })}
      >
        <SelectValue>
          <DealStagePill stage={current} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {dealStages.map((stage) => (
          <SelectItem key={stage.value} value={stage.value}>
            <DealStagePill stage={stage.value} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
