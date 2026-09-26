import type { ComponentProps, ComponentType } from "react";
import { AppleMark } from "~/components/apple-mark";
import { GitHubMark } from "~/components/github-mark";
import type { ButtonProps } from "~/components/ui/button";
import type { SignInProvider } from "~/lib/sign-in-providers";

/** How each provider is named and drawn. */
export const PROVIDER_BRANDING: Record<
  SignInProvider,
  {
    name: string;
    Mark: ComponentType<ComponentProps<"svg">>;
    button: { variant?: ButtonProps["variant"]; className?: string };
  }
> = {
  apple: {
    name: "Apple",
    Mark: AppleMark,
    // Apple allows its button black on a light page and white on a dark one.
    button: {
      className: "bg-foreground text-background hover:bg-foreground/90",
    },
  },
  github: { name: "GitHub", Mark: GitHubMark, button: { variant: "outline" } },
};
