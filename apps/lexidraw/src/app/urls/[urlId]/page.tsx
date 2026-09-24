"use cache: private";

import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { entityTag } from "~/server/api/entity-cache";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { urlId } = await props.params;
  cacheTag(entityTag(urlId));
  const link = await api.entities.getMetadata
    .query({ id: urlId })
    .catch(() => null);
  return {
    title: link?.title || "Link",
    appleWebApp: { capable: true, statusBarStyle: "black", title: "Lexidraw" },
  };
}

// export const fetchCache = "force-no-store";

const Params = z.object({
  urlId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
  searchParams: Promise<{
    new?: "true";
    parentId?: string;
  }>;
};

export default async function UrlPage(props: Props) {
  const [param, search] = await Promise.all([props.params, props.searchParams]);
  const { urlId } = Params.parse(param);
  const { new: isNew, parentId } = search ?? {};

  // What this render is about, so a write to it over any transport drops this
  // entry rather than leaving a stale link on screen until it expires.
  cacheTag(entityTag(urlId));

  if (isNew === "true") {
    await api.entities.create.mutate({
      id: urlId,
      title: "New link",
      entityType: "url",
      elements: JSON.stringify({ url: "" }),
      parentId: parentId ?? null,
    });
    return redirect(`/urls/${urlId}`);
  }

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
