"use cache: private";

import type { Metadata } from "next";
import { cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { entityTag } from "~/server/api/entity-cache";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";

export const metadata: Metadata = {
  title: "Lexidraw | url",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

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

  // First, so a missing link is a 404 even for a visitor the calls
  // below refuse.
  const entity = await api.entities.load.query({ id: urlId }).catch(notFoundOr);
  const [audioConfig, ttsCatalog] = await Promise.all([
    api.config.getAudioConfig.query(),
    api.config.getTtsCatalog.query(),
  ]);

  const UrlViewer = (await import("./url-viewer")).default;
  return (
    <UrlViewer
      entity={entity}
      preferredPlaybackRate={audioConfig?.preferredPlaybackRate ?? 1}
      ttsConfig={ttsCatalog}
    />
  );
}
