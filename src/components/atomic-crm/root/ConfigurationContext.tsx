import { useMemo } from "react";
import { useStore } from "ra-core";

import type { DealStage, LabeledValue, NoteStatus } from "../types";
import { defaultConfiguration } from "./defaultConfiguration";
import { localizeDealStages } from "../deals/dealUtils";

export const CONFIGURATION_STORE_KEY = "app.configuration";

export interface ConfigurationContextValue {
  companySectors: LabeledValue[];
  currency: string;
  dealCategories: LabeledValue[];
  dealPipelineStatuses: string[];
  dealStages: DealStage[];
  noteStatuses: NoteStatus[];
  taskTypes: LabeledValue[];
  title: string;
  darkModeLogo: string;
  lightModeLogo: string;
  googleWorkplaceDomain?: string;
  disableEmailPasswordAuthentication?: boolean;
}

export const useConfigurationContext = () => {
  const [config] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
    defaultConfiguration,
  );
  return useMemo(() => {
    const merged = { ...defaultConfiguration, ...config };

    if (merged.currency === "USD") {
      merged.currency = defaultConfiguration.currency;
    }

    merged.dealStages = localizeDealStages(merged.dealStages);

    return merged;
  }, [config]);
};

export const useConfigurationUpdater = () => {
  const [, setConfig] = useStore<ConfigurationContextValue>(
    CONFIGURATION_STORE_KEY,
  );
  return setConfig;
};
