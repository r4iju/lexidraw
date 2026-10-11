import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  useState,
  useEffect,
  useLayoutEffect,
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
import { powerPreference } from "~/lib/byok/preference";
import {
  ThumbnailSnapshot,
  ThumbnailReceipt,
} from "~/lib/images/thumbnail-receipt";
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

export type ImageGenerationAccess =
  | { kind: "loading" | "error" | "unavailable"; message: string }
  | { kind: "ready" };

export type GeneratedImageOutcome =
  | {
      kind: "completed";
      identity: string;
      imageData: Uint8Array;
      mimeType: string;
      prompt: string;
    }
  | { kind: "declined" }
  | { kind: "unavailable" | "uncertain" | "failed"; message: string };

type ImageGenerationContextValue = {
  access: ImageGenerationAccess;
  retryAccess: () => void;
  acknowledgeImage: (receipt: SaveReceipt) => Promise<boolean>;
  retained: boolean;
  insertImage: (
    insert: (
      url: string,
      prompt: string,
      check: () => void,
    ) => Promise<SaveReceipt | null>,
  ) => Promise<boolean>;
  isConfigured: boolean;
  isLoading: boolean;
  saveThumbnail: (identity: string) => Promise<boolean>;
  owner: string;
  previewRetainedImage: () => GeneratedImageOutcome | null;
  generateImageData: (
    prompt: string,
    options?: { size?: "256x256" | "512x512" | "1024x1024" },
  ) => Promise<GeneratedImageOutcome>;
  uploadImageData: (identity: string) => Promise<string | null>;
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
  const authenticated = signedIn && identity.status === "authenticated";
  const source = api.auth.getPowerPreference.useQuery(undefined, {
    enabled: authenticated,
  });
  const capability = api.imagePower.capability.useQuery(undefined, {
    enabled: authenticated,
  });
  const preference = queryAccess(source, authenticated, "AI power preference");
  const access = queryAccess(capability, authenticated, "Image capability");
  const generationAccess: ImageGenerationAccess = !authenticated
    ? identity.status === "loading"
      ? {
          kind: "loading",
          message: "Checking your account before loading image access.",
        }
      : { kind: "unavailable", message: "Sign in to generate images." }
    : preference.kind === "loading" || preference.kind === "error"
      ? preference
      : access.kind === "loading" || access.kind === "error"
        ? access
        : preference.kind !== "ready" || access.kind !== "ready"
          ? { kind: "unavailable", message: "Sign in to generate images." }
          : preference.data.mode === "local"
            ? {
                kind: "unavailable",
                message:
                  "Local image generation is unavailable on this device.",
              }
            : !access.data.available
              ? {
                  kind: "unavailable",
                  message:
                    access.data.reason ??
                    "Image generation is unavailable for this source.",
                }
              : !byok
                ? {
                    kind: "loading",
                    message: "Device account session is not ready.",
                  }
                : { kind: "ready" };
  const retryAccess = () => {
    if (preference.kind === "error") void source.refetch();
    if (access.kind === "error") void capability.refetch();
  };
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
  const commitThumbnail = api.entities.commitGeneratedThumbnail.useMutation({
    onSuccess: () => utils.entities.invalidate(),
  });
  const cancel = api.imagePower.cancel.useMutation({
    onSettled: (_data, _error, input) =>
      Promise.all([
        utils.pro.status.invalidate(),
        utils.imagePower.operation.invalidate({ id: input.id }),
        utils.imagePower.current.invalidate(),
      ]),
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
      const operation = await cancel.mutateAsync({ id });
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
        return browserNarrationStore.save(
          owner,
          data,
          expected,
          () =>
            browserByokAccount() === accountId &&
            browserByokSessionGeneration() === generation,
        );
      },
      clear: (expected) => {
        currentOwner();
        return browserNarrationStore.clear(
          owner,
          expected,
          () =>
            browserByokAccount() === accountId &&
            browserByokSessionGeneration() === generation,
        );
      },
    });
  }, [entityId, accountId, generation]);
  // ImageFlow receives external query and account ports only after React commits.
  useLayoutEffect(() => {
    flow.configure(ports);
  });
  // ImageFlow and IndexedDB registration share the committed document/session lifetime.
  useEffect(() => {
    flow.activate();
    let disposed = false;
    let unregister: (() => void) | undefined;
    if (accountId)
      void browserByokStorageReady(accountId)
        .then(() => {
          if (
            disposed ||
            browserByokAccount() !== accountId ||
            browserByokSessionGeneration() !== generation
          )
            return;
          unregister = registerNarration(
            accountId,
            async () => {
              flow.end();
            },
            generation,
          );
          void flow.restore();
        })
        .catch(() => {});
    return () => {
      disposed = true;
      unregister?.();
      flow.end();
    };
  }, [flow, accountId, generation]);
  const state = useSyncExternalStore(flow.subscribe, flow.state, flow.state);
  const isConfigured = generationAccess.kind === "ready";
  const isLoading = ["quote", "generating", "saving"].includes(state.kind);
  const previewRetainedImage = useCallback((): GeneratedImageOutcome | null => {
    const final = flow.state();
    if (!completed(final) || !("image" in final)) return null;
    const result = validateImage(final.image, assertOwner().assertSafe);
    return {
      kind: "completed",
      identity: final.uploadId,
      imageData: result.bytes,
      mimeType: result.image.mimeType,
      prompt: final.prompt,
    };
  }, [flow, assertOwner]);
  const generateImageData = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ): Promise<GeneratedImageOutcome> => {
      if (options?.size && options.size !== "1024x1024")
        return {
          kind: "unavailable",
          message: "Only the tuned image configuration is supported.",
        };
      if (generationAccess.kind !== "ready")
        return { kind: "unavailable", message: generationAccess.message };
      try {
        await flow.generate(prompt);
        const final = await waitFor(
          flow,
          (x) => !["quote", "generating"].includes(x.kind),
        );
        const result = previewRetainedImage();
        if (result) return result;
        if (final.kind === "failed" || final.kind === "unavailable")
          return final;
        if (final.kind === "uncertain")
          return {
            kind: "uncertain",
            message:
              "The original image outcome is uncertain. Check recovery before generating again.",
          };
        if (final.kind === "declined") return { kind: "declined" };
        return {
          kind: "failed",
          message:
            "Image action ended. Check retained recovery before generating again.",
        };
      } catch {
        return {
          kind: "failed",
          message:
            "Image action ended. Check retained recovery before generating again.",
        };
      }
    },
    [flow, generationAccess, previewRetainedImage],
  );
  const uploadImageData = useCallback(
    (identity: string) => flow.upload(identity),
    [flow],
  );
  return (
    <ImageGenerationContext.Provider
      value={{
        saveThumbnail: async (identity) => {
          assertOwner();
          const expected = ThumbnailSnapshot.parse(
            await utils.entities.generatedThumbnail.fetch({ entityId }),
          );
          assertOwner();
          return flow.commitThumbnail(
            identity,
            entityId,
            expected.revision,
            async (): Promise<ThumbnailReceipt | null> => {
              assertOwner();
              const receipt = await commitThumbnail.mutateAsync({
                entityId,
                uploadId: identity,
                expected,
              });
              assertOwner();
              const parsed = ThumbnailReceipt.parse(receipt);
              const current = ThumbnailSnapshot.parse(
                await utils.entities.generatedThumbnail.fetch({ entityId }),
              );
              assertOwner();
              if (
                current.light !== parsed.light ||
                current.dark !== parsed.dark ||
                current.revision !== parsed.revision
              )
                return null;
              return parsed;
            },
          );
        },
        owner: JSON.stringify([entityId, accountId, generation]),
        previewRetainedImage,
        access: generationAccess,
        retryAccess,
        isConfigured,
        isLoading,
        retained: completed(state),
        insertImage: (insert) => flow.insert(insert),
        generateImageData,
        uploadImageData,
        acknowledgeImage: (receipt) => flow.acknowledge(receipt),
      }}
    >
      {children}
      {generationAccess.kind !== "ready" && (
        <div role={generationAccess.kind === "error" ? "alert" : "status"}>
          <p>{generationAccess.message}</p>
          {generationAccess.kind === "error" && (
            <Button type="button" variant="outline" onClick={retryAccess}>
              Retry
            </Button>
          )}
        </div>
      )}
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
      {"image" in state && state.durability === "memory_only" && (
        <div role="alert">
          <p>
            Image retained in memory only. Reopen recovery is unconfirmed. Keep
            this document open and retry checkpointing.
          </p>
          <Button onClick={() => void flow.retryCheckpoint()}>
            Retry image checkpoint
          </Button>
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
  access: ImageGenerationAccess;
  retryAccess: () => void;
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
  const {
    access,
    retryAccess,
    isConfigured,
    generateImageData,
    retained,
    insertImage,
  } = useImageGeneration();
  const [isLoading, setIsLoading] = useState(false);
  const insertAndAcknowledge = useCallback(async () => {
    if (
      !(await insertImage((url, prompt, check) =>
        insertRetainedImage(editor, url, prompt, persist, check),
      ))
    )
      toast.error(
        "Image retained. Document save did not confirm its insertion.",
      );
  }, [insertImage, editor, persist]);

  const retryInsertion = async () => {
    setIsLoading(true);
    try {
      await insertAndAcknowledge();
    } catch {
      toast.error(
        "Image retained. Retry document save when this document is ready.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const generateAndInsertImage = useCallback(
    async (
      prompt: string,
      options?: { size?: "256x256" | "512x512" | "1024x1024" },
    ) => {
      if (access.kind !== "ready") {
        toast.error(access.message);
        return;
      }
      setIsLoading(true);
      toast.info("Generating Image...", { description: prompt });
      try {
        const gen = await generateImageData(prompt, options);
        if (gen.kind !== "completed") {
          if (gen.kind !== "declined") toast.error(gen.message);
          return;
        }
        await insertAndAcknowledge();
      } catch (err) {
        toast.error("Process Failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [access, generateImageData, insertAndAcknowledge],
  );

  return (
    <LexicalImageContext.Provider
      value={{
        access,
        retryAccess,
        isLoading,
        isConfigured,
        generateAndInsertImage,
      }}
    >
      {children}
      {retained && (
        <Button disabled={isLoading} onClick={() => void retryInsertion()}>
          Insert retained image / retry document save
        </Button>
      )}
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
