import Image, { getImageProps } from "next/image";
import { cn } from "~/lib/utils";

const FEATURES = [
  {
    title: "Docs that do more",
    benefit: "Headings, tables, embeds and slides, all in one page.",
    image: "document",
    dark: true,
    alt: "A Lexidraw document titled Launch plan, with a list of goals and a timeline table of weekly milestones and owners.",
  },
  {
    title: "Sketch it out",
    benefit: "Hand-drawn diagrams and wireframes on an open canvas.",
    image: "drawing",
    dark: false,
    alt: "A hand-drawn sign-up flow in Lexidraw: landing page, sign up and a verified check, leading to Home or to resending the link.",
  },
  {
    title: "Find it again",
    benefit: "Folders, favorites and search through every word you wrote.",
    image: "home",
    dark: true,
    alt: "Lexidraw's Home showing a Product launch folder, with previews of its documents, drawings and a subfolder.",
  },
] as const;

/** What Lexidraw does, each shown in a picture of it. */
export function LandingFeatures() {
  return (
    <section
      aria-label="What you can do"
      className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-20 sm:px-6 md:gap-24 md:pb-28 lg:px-8"
    >
      {FEATURES.map((feature, index) => (
        <figure
          key={feature.image}
          className="grid items-center gap-6 md:grid-cols-12 md:gap-10"
        >
          <div
            className={cn(
              "relative aspect-8/5 overflow-hidden rounded-xl border border-border bg-card shadow-sm md:col-span-8",
              index % 2 === 1 && "md:order-last",
            )}
          >
            {index === 0 && feature.dark ? (
              <FirstPicture feature={feature} />
            ) : (
              <ThemedPicture feature={feature} />
            )}
          </div>
          <figcaption className="flex flex-col gap-2 md:col-span-4">
            <h2 className="font-brand text-2xl md:text-3xl">{feature.title}</h2>
            <p className="text-lg text-muted-foreground">{feature.benefit}</p>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

const SIZES = "(max-width: 768px) 100vw, 66vw";

type Feature = (typeof FEATURES)[number];

function ThemedPicture({
  feature,
  lightClassName,
  darkClassName = "hidden dark:block",
}: {
  feature: Feature;
  lightClassName?: string;
  darkClassName?: string;
}) {
  return (
    <>
      <Image
        src={`/images/landing/${feature.image}-light.webp`}
        alt={feature.alt}
        fill
        sizes={SIZES}
        className={cn(
          "object-cover object-top-left",
          lightClassName ?? (feature.dark && "dark:hidden"),
        )}
      />
      {feature.dark && (
        <Image
          src={`/images/landing/${feature.image}-dark.webp`}
          alt={feature.alt}
          fill
          sizes={SIZES}
          className={cn("object-cover object-top-left", darkClassName)}
        />
      )}
    </>
  );
}

/**
 * The first picture downloads at once, before the theme's script has said
 * which theme the reader chose, so it follows the system's; a reader who
 * chose the other one waits for that copy instead.
 */
function FirstPicture({ feature }: { feature: Feature }) {
  const common = {
    alt: feature.alt,
    fill: true,
    sizes: SIZES,
    loading: "eager",
    fetchPriority: "high",
  } as const;
  const { props: dark } = getImageProps({
    ...common,
    src: `/images/landing/${feature.image}-dark.webp`,
  });
  const { props: light } = getImageProps({
    ...common,
    src: `/images/landing/${feature.image}-light.webp`,
  });
  return (
    <>
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={dark.srcSet}
          sizes={dark.sizes}
        />
        <img
          {...light}
          alt={feature.alt}
          className="object-cover object-top-left chosen-dark:hidden chosen-light:hidden"
        />
      </picture>
      <ThemedPicture
        feature={feature}
        lightClassName="hidden chosen-light:block"
        darkClassName="hidden chosen-dark:block"
      />
    </>
  );
}
