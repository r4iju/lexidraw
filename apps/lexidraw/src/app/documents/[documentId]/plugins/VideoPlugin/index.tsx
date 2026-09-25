import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement } from "@lexical/utils";
import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_EDITOR,
  type LexicalCommand,
  type LexicalEditor,
  createCommand,
} from "lexical";
import { useEffect, useState, useCallback } from "react";
import type * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import FileInput, { UploadingNote } from "~/components/ui/file-input";
import { Button } from "~/components/ui/button";
import { useVideoUpload } from "~/hooks/use-media-upload";
import { usePickedUpload } from "~/hooks/use-picked-upload";
import { useEntityId } from "~/hooks/use-entity-id";
import { VideoNode, type VideoPayload } from "../../nodes/VideoNode/VideoNode";
import { INSERT_VIDEO_COMMAND } from "./commands";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import FormProvider from "~/components/hook-form";
import { useFieldArray, useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "~/components/ui/textarea";

function InsertVideoUploadedDialogBody({
  onClick,
  onCancel,
}: {
  onClick: (payload: VideoPayload) => void;
  onCancel: () => void;
}) {
  const { src, pending, pick } = usePickedUpload(useVideoUpload(useEntityId()));
  const isDisabled = src === "";

  return (
    <div className="space-y-4">
      <FileInput
        label="Video Upload"
        onChange={pick}
        accept="video/*"
        className="pb-[2px]"
      />
      {pending && <UploadingNote />}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={isDisabled}
          onClick={() => onClick({ src, showCaption: true })}
        >
          Insert video
        </Button>
      </DialogFooter>
    </div>
  );
}

export function InsertVideoDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState("upload");
  const insertVideo = useCallback(
    (payload: VideoPayload) => {
      activeEditor.dispatchCommand(INSERT_VIDEO_COMMAND, payload);
      onClose();
    },
    [activeEditor, onClose],
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="mb-4 w-full">
        <TabsTrigger className="flex-1" value="upload">
          Upload
        </TabsTrigger>
        <TabsTrigger className="flex-1" value="settings">
          Download settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="upload">
        <InsertVideoUploadedDialogBody
          onClick={insertVideo}
          onCancel={onClose}
        />
      </TabsContent>
      <TabsContent value="settings">
        <VideoDownloadSettings onClose={() => setTab("upload")} />
      </TabsContent>
    </Tabs>
  );
}

// Command to trigger the dialog open state from outside (e.g. toolbar)
// Using createCommand() and letting TypeScript infer type if void causes issues.
// If LexicalCommand<void> is indeed the pattern, this linter error is likely config-related.
export const OPEN_INSERT_VIDEO_DIALOG_COMMAND: LexicalCommand<unknown> =
  createCommand("OPEN_INSERT_VIDEO_DIALOG_COMMAND");

export default function VideoPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!editor.hasNodes([VideoNode])) {
      throw new Error("VideosPlugin: VideoNode not registered on editor");
    }

    const unregisterInsert = editor.registerCommand<VideoPayload>(
      INSERT_VIDEO_COMMAND,
      (payload) => {
        editor.update(() => {
          const videoNode = VideoNode.$createVideoNode(payload);
          $insertNodes([videoNode]);
          if ($isRootOrShadowRoot(videoNode.getParentOrThrow())) {
            $wrapNodeInElement(videoNode, $createParagraphNode).selectEnd();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    const unregisterOpenDialogCommand = editor.registerCommand(
      OPEN_INSERT_VIDEO_DIALOG_COMMAND,
      () => {
        setIsModalOpen(true);
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );

    return () => {
      unregisterInsert();
      unregisterOpenDialogCommand();
    };
  }, [editor]); // Dependency array includes editor

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  if (!isModalOpen) return null;

  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert video</DialogTitle>
        </DialogHeader>
        <InsertVideoDialog activeEditor={editor} onClose={closeModal} />
      </DialogContent>
    </Dialog>
  );
}

/** Cookies for sites that only share video with a signed-in viewer. */
function VideoDownloadSettings({ onClose }: { onClose: () => void }) {
  const schema = z.object({
    cookies: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      }),
    ),
  });
  const { data: cookies } = api.entities.getCookies.useQuery();
  const { mutate: setCookies, isPending } =
    api.entities.setCookies.useMutation();
  const methods = useForm({
    resolver: standardSchemaResolver(schema),
    defaultValues: {
      cookies: [],
    },
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isValid, isDirty },
  } = methods;
  const { fields, append, remove } = useFieldArray({
    control,
    name: "cookies",
  });

  useEffect(() => {
    reset({ cookies });
  }, [cookies, reset]);

  const onSubmit = ({ cookies }: z.infer<typeof schema>) => {
    setCookies(
      {
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          value: cookiesTxtToHeader(cookie.value),
        })),
      },
      {
        onSuccess: () => {
          toast.success("Cookies saved");
          onClose();
        },
        onError: (error) => {
          toast.error("Error saving cookies:", {
            description: error.message,
          });
        },
      },
    );
  };

  /**
   * Convert the contents of a Netscape cookies.txt file (as a string)
   * to a single "name=value; ..." cookie header string that can be passed
   * to yt‑dlp, e.g.   --cookies "SID=...; HSID=..."
   *
   * @example
   * const txt = await Bun.file('/tmp/cookies.txt').text();
   * const header = cookiesTxtToHeader(txt); // "SID=abcd; HSID=efgh"
   */
  const cookiesTxtToHeader = (cookiesTxt: string): string => {
    return cookiesTxt
      .split(/\r?\n/) // split into lines
      .map((line) => line.trim()) // trim whitespace
      .filter(
        (line) =>
          line !== "" && // ignore blanks
          !line.startsWith("#"), // ignore comments
      )
      .map((line) => {
        // Netscape format: domain<TAB>flag<TAB>path<TAB>secure<TAB>expires<TAB>name<TAB>value
        const parts = line.split("\t");
        // Gracefully skip malformed lines
        if (parts.length < 7) return null;
        const name = parts[5];
        const value = parts[6];
        return `${name}=${value}`;
      })
      .filter(Boolean) // drop nulls
      .join("; "); // join into header string
  };

  return (
    <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
      <p className="text-sm text-muted-foreground">
        Some sites only show their pages to a signed-in viewer. Paste a site's
        cookies.txt export so links you save from it can be read.
      </p>
      <div className="flex flex-col gap-4">
        {fields.map((_field, index) => (
          <div key={`cookie-${_field.id}`} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                id={`cookie-name-${index}`}
                placeholder="youtube.com"
                {...register(`cookies.${index}.name` as const)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => remove(index)}
                aria-label="Remove cookie"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <Textarea
              id={`cookie-value-${index}`}
              rows={3}
              placeholder="1234567890"
              {...register(`cookies.${index}.value` as const)}
              className="flex-1"
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => append({ name: "", value: "" })}
        className="w-full flex items-center gap-2"
      >
        <Plus className="size-4" />
        Add cookie
      </Button>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!isValid || !isDirty}
          pending={isPending}
        >
          Save settings
        </Button>
      </DialogFooter>
    </FormProvider>
  );
}
