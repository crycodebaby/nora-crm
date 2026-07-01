import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Notification } from "@/components/admin/notification";

import {
  defaultLightModeLogo,
  defaultOperatorDarkLogo,
  defaultOperatorLightLogo,
  defaultOperatorName,
  defaultTitle,
} from "../root/defaultConfiguration";
import { useConfigurationContext } from "../root/ConfigurationContext";

export const NoraLandingPage = ({ redirectTo }: { redirectTo?: string }) => {
  const translate = useTranslate();
  const {
    lightModeLogo,
    darkModeLogo,
    title,
    disableEmailPasswordAuthentication,
  } = useConfigurationContext();

  const productLogo = lightModeLogo || defaultLightModeLogo;
  const productLogoDark = darkModeLogo || productLogo;

  const loginTo = redirectTo
    ? {
        pathname: "/login",
        search: `?mode=anmelden&redirect=${encodeURIComponent(redirectTo)}`,
      }
    : { pathname: "/login", search: "?mode=anmelden" };

  return (
    <div className="nora-landing min-h-svh flex flex-col bg-background">
      <header className="w-full px-5 py-5 md:px-8 md:py-6">
        <div className="nora-operator-brand max-w-screen-xl mx-auto">
          <img
            src={defaultOperatorLightLogo}
            alt=""
            aria-hidden
            className="h-8 w-8 shrink-0 [.dark_&]:hidden"
          />
          <img
            src={defaultOperatorDarkLogo}
            alt=""
            aria-hidden
            className="h-8 w-8 shrink-0 hidden [.dark_&]:block"
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {defaultOperatorName}
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-12 md:px-8">
        <div className="w-full max-w-md flex flex-col items-center text-center gap-8">
          <div className="nora-product-brand flex flex-col items-center gap-4">
            <img
              src={productLogo}
              alt=""
              className="h-16 w-16 [.dark_&]:hidden"
            />
            <img
              src={productLogoDark}
              alt=""
              className="h-16 w-16 hidden [.dark_&]:block"
            />
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
                {title || defaultTitle}
              </h1>
              <p className="nora-muted text-base md:text-lg max-w-sm mx-auto">
                {translate("crm.landing.subline")}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:min-w-[20rem]">
            <Button
              asChild
              size="lg"
              className="nora-primary-action nora-touch-target w-full sm:flex-1"
            >
              <Link to={loginTo}>{translate("crm.landing.sign_in")}</Link>
            </Button>
            {disableEmailPasswordAuthentication ? null : (
              <Button
                asChild
                variant="outline"
                size="lg"
                className="nora-secondary-action nora-touch-target w-full sm:flex-1 border-border"
              >
                <Link to="/sign-up">{translate("crm.landing.sign_up")}</Link>
              </Button>
            )}
          </div>
        </div>
      </main>

      <Notification />
    </div>
  );
};
