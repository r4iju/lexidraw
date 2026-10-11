import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { useSession } from "next-auth/react";
import {
  useBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
} from "~/lib/byok/browser-session";
import {
  browserNarrationStore,
  registerNarration,
} from "~/lib/narration/device-store";
import { browserByokStorageReady } from "~/lib/byok/browser-session";
import type { SaveReceipt } from "~/lib/open-entity-sync";
import { insertRetainedImage } from "~/lib/images/insert";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import { powerPreference } from "~/lib/byok/preference";
import { ImageFlow, type ImageState } from "~/lib/images/flow";
import { validateImage } from "~/lib/images/contracts";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";

type ImageGenerationContextValue = {
  acknowledgeImage: (receipt: SaveReceipt) => Promise<boolean>;
  isConfigured: boolean;
  isLoading: boolean;
  generateImageData: (
    prompt: string,
    options?: { size?: "256x256" | "512x512" | "1024x1024" },
  ) => Promise<{
    imageData: Uint8Array;
    mimeType: string;
    prompt: string;
  } | null>;
  uploadImageData: (
    imageData: Uint8Array,
    mimeType: string,
    prompt: string,
  ) => Promise<string | null>;
};
const ImageGenerationContext =
  createContext<ImageGenerationContextValue | null>(null);
function completed(state: ImageState) {
  return (
    state.kind === "completed" ||
    state.kind === "sync_failed" ||
    state.kind === "saved"
  );
}
function waitFor(
  flow: ImageFlow,
  ready: (state: ImageState) => boolean,
): Promise<ImageState> {
  if (ready(flow.state())) return Promise.resolve(flow.state());
  return new Promise((resolve) => {
    const stop = flow.subscribe(() => {
      if (ready(flow.state())) {
        stop();
        resolve(flow.state());
      }
    });
  });
}
export function ImageGenerationProvider({
  entityId,
  signedIn,
  children,
}: {
  entityId: string;
  signedIn: boolean;
  children: ReactNode;
}) {
  const identity = useSession();
  const accountId =
    identity.status === "authenticated" ? identity.data.user.id : undefined;
  const byok = useBrowserByok(accountId);
  const generation = browserByokSessionGeneration();
  const assertOwner = useCallback(() => {
    if (
      !byok ||
      !accountId ||
      browserByokAccount() !== accountId ||
      browserByokSessionGeneration() !== generation
    )
      throw new Error("Device account session is not ready.");
    return byok;
  }, [byok, accountId, generation]);
  const source = api.auth.getPowerPreference.useQuery(undefined, {
    enabled: signedIn,
  });
  const capability = api.imagePower.capability.useQuery(undefined, {
    enabled: signedIn,
  });
  const preference = queryAccess(source, signedIn, "AI power preference");
  const access = queryAccess(capability, signedIn, "Image capability");
  function assertReady() {
    if (preference.kind !== "ready" || access.kind !== "ready")
      throw new Error(
        preference.kind === "error" || preference.kind === "loading"
          ? preference.message
          : access.kind === "error" || access.kind === "loading"
            ? access.message
            : "Sign in to generate images.",
      );
    return { preference: preference.data, capability: access.data };
  }
  const utils = api.useUtils();
  const generate = api.imagePower.generate.useMutation({
    onSettled: () => utils.pro.status.invalidate(),
  });
  const save = api.imagePower.save.useMutation({
    onSuccess: () => utils.entities.invalidate(),
  });
  const ports = {
    source: () => powerPreference(assertReady().preference),
    availability: () => assertReady().capability,
    get byok() {
      return assertOwner();
    },
    pro: async (input: {
      idempotencyKey: string;
      prompt: string;
      acceptedMaximum: number;
    }) => {
      assertReady();
      assertOwner();
      const operation = await generate.mutateAsync(input);
      assertOwner();
      return operation;
    },
    readPro: async (key: string) => {
      assertOwner();
      const operation = await utils.imagePower.current.fetch({
        idempotencyKey: key,
      });
      assertOwner();
      return operation;
    },
    cancelPro: async (id: string) => {
      assertOwner();
      const operation = await utils.client.imagePower.cancel.mutate({ id });
      assertOwner();
      return operation;
    },
    save: async (
      uploadId: string,
      image: import("~/lib/images/contracts").ImageArtifact,
    ) => {
      assertOwner().assertEgress(JSON.stringify(image));
      const receipt = await save.mutateAsync({
        entityId,
        idempotencyKey: uploadId,
        image,
      });
      assertOwner();
      const url = new URL(receipt.url, window.location.origin);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== `/api/generated-images/${receipt.id}` ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("Image receipt is invalid.");
      return url.href;
    },
  };
  // The flow owns event lifetimes and retained image memory for this entity.
  const flow = useMemo(() => {
    if (!entityId) throw new Error("Image document identity required");
    if (!accountId) return new ImageFlow();
    const currentOwner = () => {
      if (
        browserByokAccount() !== accountId ||
        browserByokSessionGeneration() !== generation
      )
        throw new Error("Image account owner ended");
    };
    const owner = JSON.stringify([
      accountId,
      entityId,
      "images-v1",
      new URL(window.location.origin).origin,
    ]);
    return new ImageFlow(undefined, {
      owner,
      load: async () => {
        currentOwner();
        await browserByokStorageReady(accountId);
        currentOwner();
        return browserNarrationStore.load(owner);
      },
      save: (data, expected) => {
        currentOwner();
        return browserNarrationStore.save(owner, data, expected);
      },
      clear: (expected) => {
        currentOwner();
        return browserNarrationStore.clear(owner, expected);
      },
    });
  }, [entityId, accountId, generation]);
  flow.configure(ports);
  useEffect(() => {
    flow.activate();
    let disposed = false;
    let unregister: (() => void) | undefined;
    if (accountId)
      void browserByokStorageReady(accountId)
        .then(() => {
          if (disposed) return;
          unregister = registerNarration(accountId, async () => {
            flow.end();
          });
          void flow.restore();
        })
        .catch(() => {});
    return () => {
      disposed = true;
      unregister?.();
      flow.end();
    };
  }, [flow, accountId]);
  const state = useSyncExternalStore(flow.subscribe, flow.state, flow.state);
  const isConfigured =
    !!byok &&
    preference.kind === "ready" &&
    access.kind === "ready" &&
    access.data.available &&
    preference.data.mode !== "local";
  const isLoading = ["quote", "generating", "saving"].includes(state.kind);
  const generateImageData = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ) => {
      if (options?.size && options.size !== "1024x1024") {
        toast.error("Only the tuned image configuration is supported.");
        return null;
      }
      if (!isConfigured) {
        toast.error(
          preference.kind === "error" || preference.kind === "loading"
            ? preference.message
            : access.kind === "error" || access.kind === "loading"
              ? access.message
              : "Image generation is unavailable for this source.",
        );
        return null;
      }
      await flow.generate(prompt);
      const final = await waitFor(
        flow,
        (x) => !["quote", "generating"].includes(x.kind),
      );
      if (!completed(final)) {
        if (final.kind === "failed" || final.kind === "unavailable")
          toast.error(final.message);
        return null;
      }
      if (!("image" in final)) return null;
      const result = validateImage(final.image, assertOwner().assertSafe);
      return {
        imageData: result.bytes,
        mimeType: result.image.mimeType,
        prompt: final.prompt,
      };
    },
    [flow, isConfigured, preference, access, assertOwner],
  );
  const uploadImageData = useCallback(async () => {
    const url = await flow.upload();
    if (url) return url;
    if (flow.state().kind !== "sync_failed") return null;
    const final = await waitFor(
      flow,
      (x) => x.kind === "saved" || x.kind === "idle",
    );
    return final.kind === "saved" ? final.url : null;
  }, [flow]);
  return (
    <ImageGenerationContext.Provider
      value={{
        isConfigured,
        isLoading,
        generateImageData,
        uploadImageData,
        acknowledgeImage: (receipt) => flow.acknowledge(receipt),
      }}
    >
      {children}
      <QueryNotice access={preference} retry={() => void source.refetch()} />
      <QueryNotice access={access} retry={() => void capability.refetch()} />
      <Dialog
        open={state.kind === "quote"}
        onOpenChange={(open) => {
          if (!open) flow.decline();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate an image</DialogTitle>
            <DialogDescription>
              {state.kind === "quote"
                ? `Maximum ${state.maximum / 1_000_000} credits. Accept this reservation before generation. Technical failures return it; uncertain work stays reserved for reconciliation. Regeneration is a new action.${state.fixture ? " Injected fixture only, no actual service verification." : ""}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => flow.decline()}>
              Decline
            </Button>
            <Button disabled={!isConfigured} onClick={() => void flow.accept()}>
              Accept maximum and generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {state.kind === "uncertain" && (
        <div role="alert">
          <p>
            The original image outcome is uncertain. New generation is blocked.
          </p>
          {state.source === "pro" && (
            <Button onClick={() => void flow.recover()}>
              Read original image
            </Button>
          )}
          {state.operation && (
            <Button onClick={() => void flow.cancel()}>
              Stop original image work
            </Button>
          )}
        </div>
      )}
      {state.kind === "saved" && (
        <div role="status">
          Image artifact retained until document persistence is confirmed.
        </div>
      )}
      {state.kind === "sync_failed" && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 rounded border bg-background p-4"
        >
          <p>
            Image completed. Sync failed. Retry upload without regeneration or
            another charge.
          </p>
          <Button onClick={() => void flow.upload()}>Retry image upload</Button>
        </div>
      )}
    </ImageGenerationContext.Provider>
  );
}
export function useImageGeneration() {
  const value = useContext(ImageGenerationContext);
  if (!value) throw new Error("ImageGenerationProvider required");
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Lexical provider + hook (builds on the simple one)
// ─────────────────────────────────────────────────────────────────────────────

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
type LexicalImageContextValue = {
  isLoading: boolean;
  isConfigured: boolean;
  generateAndInsertImage: (
    prompt: string,
    options?: {
      size?: "256x256" | "512x512" | "1024x1024";
    },
  ) => Promise<void>;
};

const LexicalImageContext = createContext<LexicalImageContextValue | null>(
  null,
);

export const LexicalImageGenerationProvider = ({
  children,
  persist,
}: {
  children: ReactNode;
  persist: (state: import("lexical").EditorState) => Promise<SaveReceipt>;
}) => {
  const [editor] = useLexicalComposerContext();
  const { isConfigured, generateImageData, uploadImageData, acknowledgeImage } =
    useImageGeneration();
  const [isLoading, setIsLoading] = useState(false);

  const generateAndInsertImage = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ) => {
      if (!isConfigured) {
        toast.error("Not configured.");
        return;
      }
      setIsLoading(true);
      toast.info("Generating Image...", { description: prompt });
      try {
        const gen = await generateImageData(prompt, options);
        if (!gen) return;
        const url = await uploadImageData(gen.imageData, gen.mimeType, prompt);
        if (!url) return;
        toast.info("Inserting Image...", { description: "" });
        const receipt = await insertRetainedImage(
          editor,
          url,
          gen.prompt,
          persist,
        );
        if (!receipt || !(await acknowledgeImage(receipt)))
          toast.error(
            "Image retained. Document save did not confirm its insertion.",
          );
      } catch (err) {
        toast.error("Process Failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      isConfigured,
      generateImageData,
      uploadImageData,
      editor,
      persist,
      acknowledgeImage,
    ],
  );

  return (
    <LexicalImageContext.Provider
      value={{ isLoading, isConfigured, generateAndInsertImage }}
    >
      {children}
    </LexicalImageContext.Provider>
  );
};

export const useLexicalImageGeneration = (): LexicalImageContextValue => {
  const ctx = useContext(LexicalImageContext);
  if (!ctx) {
    throw new Error(
      "useLexicalImageGeneration must be inside LexicalImageGenerationProvider",
    );
  }
  return ctx;
};
