"use cache: private";

import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { z } from "zod";
import { drizzle } from "@packages/drizzle";
import { entityTag } from "~/server/api/entity-cache";
import { entityPreview } from "~/server/entity-preview";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { urlId } = Params.parse(await props.params);
  cacheTag(entityTag(urlId));
  const [link, preview] = await Promise.all([
    api.entities.getMetadata.query({ id: urlId }).catch(() => null),
    entityPreview(drizzle, urlId),
  ]);
  return {
    title: link?.title || "Link",
    appleWebApp: { capable: true, statusBarStyle: "black", title: "Lexidraw" },
    ...preview,
  };
}

// export const fetchCache = "force-no-store";

const Params = z.object({
  urlId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
};

export default async function UrlPage(props: Props) {
  const { urlId } = Params.parse(await props.params);

  // What this render is about, so a write to it over any transport drops this
  // entry rather than leaving a stale link on screen until it expires.
  cacheTag(entityTag(urlId));

  // A missing link, or one this caller may not read, is a 404.
  const entity = await api.entities.load.query({ id: urlId }).catch(notFoundOr);
  // A visitor to a public link can read and play it but not generate audio,
  // which needs an account, and so has no use for the TTS catalog.
  const signedIn = Boolean((await auth())?.user);
  const [audioConfig, ttsCatalog] = await Promise.all([
    api.config.getAudioConfig.query(),
    signedIn ? api.config.getTtsCatalog.query() : undefined,
  ]);

  const UrlViewer = (await import("./url-viewer")).default;
  return (
    <UrlViewer
      entity={entity}
      preferredPlaybackRate={audioConfig?.preferredPlaybackRate ?? 1}
      ttsConfig={ttsCatalog}
      canGenerateAudio={signedIn}
    />
  );
}
