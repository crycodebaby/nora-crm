import { useTranslate } from "ra-core";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { ArbeitskorbSurface } from "./ArbeitskorbSurface";

/**
 * Mobile Arbeitskorb page (docs/nora/26 §9), following the house pattern:
 * `MobileHeader` with the page `h1` (no back button — an entry page) as a
 * sibling of `MobileContent`, which provides `main` and the space above the
 * fixed bottom navigation. Loaded lazily per route (AC-29).
 */
const ArbeitskorbPageMobile = () => {
  const translate = useTranslate();
  return (
    <>
      <MobileHeader>
        <h1 className="text-base font-semibold">
          {translate("crm.work.page_title")}
        </h1>
      </MobileHeader>
      <MobileContent>
        <ArbeitskorbSurface variant="mobile" />
      </MobileContent>
    </>
  );
};

export default ArbeitskorbPageMobile;
