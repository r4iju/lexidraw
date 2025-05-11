import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement } from "@lexical/utils";
import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_EDITOR,
  LexicalCommand,
  LexicalEditor,
  createCommand,
} from "lexical";
import { useEffect, useState, useCallback, useRef } from "react";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import FileInput from "~/components/ui/file-input";
import { Button } from "~/components/ui/button";
import { useUploader } from "~/hooks/use-uploader";
import { useEntityId } from "~/hooks/use-entity-id";
import { VideoNode, VideoPayload } from "../../nodes/VideoNode/VideoNode";
import { INSERT_VIDEO_COMMAND } from "./commands";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

function InsertVideoUploadedDialogBody({
  onClick,
}: {
  onClick: (payload: VideoPayload) => void;
}) {
  const { src, handleFileChange, error: uploadError } = useUploader();
  const entityId = useEntityId();
  console.log({ entityId });

  const isDisabled = src === "" || !!uploadError;

  const onChange = (files: FileList | null) => {
    handleFileChange(files, entityId, "video");
  };

  return (
    <div className="space-y-4">
      <FileInput label="Video Upload" onChange={onChange} accept="video/*" />
      {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
      <DialogFooter>
        <Button
          disabled={isDisabled}
          onClick={() => onClick({ src, showCaption: true })}
        >
          Confirm
        </Button>
      </DialogFooter>
    </div>
  );
}

function InsertVideoByUrlDialogBody({
  onInsert,
}: {
  onInsert: (payload: VideoPayload) => void;
}) {
  const entityId = useEntityId();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const { data: downloadUrl } = api.entities.getDownloadUrlByRequestId.useQuery(
    {
      requestId: requestId ?? "",
      entityId,
    },
    {
      enabled: !!requestId,
      // polling interval
      refetchInterval: 2000,
    },
  );
  const { mutate: downloadAndUploadByUrl } =
    api.entities.downloadAndUploadByUrl.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      downloadAndUploadByUrl(
        { url, entityId },
        {
          onSuccess: (data) => {
            console.log(data);
            setRequestId(data.requestId);
          },
        },
      );
    } catch {
      setLoading(false);
      setError("Failed to start video download.");
    }
  };

  useEffect(() => {
    if (downloadUrl) {
      onInsert({ src: downloadUrl, showCaption: true });
    }
  }, [downloadUrl, onInsert]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label
        htmlFor="video-url-input"
        className="block text-sm font-medium mb-1"
      >
        Video URL
      </label>
      <Input
        id="video-url-input"
        placeholder="Paste a video URL (YouTube, X, etc)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
        disabled={loading}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={loading || !url}>
          {loading ? "Processing..." : "Insert by URL"}
        </Button>
      </DialogFooter>
      {loading && (
        <div className="text-sm text-muted-foreground mt-2">
          Waiting for video to be processed... (this may take a minute)
        </div>
      )}
    </form>
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
        <TabsTrigger className="flex-1" value="url">
          By URL
        </TabsTrigger>
      </TabsList>
      <TabsContent value="upload">
        <InsertVideoUploadedDialogBody onClick={insertVideo} />
      </TabsContent>
      <TabsContent value="url">
        <InsertVideoByUrlDialogBody onInsert={insertVideo} />
      </TabsContent>
    </Tabs>
  );
}

// Command to trigger the dialog open state from outside (e.g. toolbar)
// Using createCommand() and letting TypeScript infer type if void causes issues.
// If LexicalCommand<void> is indeed the pattern, this linter error is likely config-related.
export const OPEN_INSERT_VIDEO_DIALOG_COMMAND: LexicalCommand<unknown> =
  createCommand("OPEN_INSERT_VIDEO_DIALOG_COMMAND");

export default function VideosPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const modalOnCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    modalOnCloseRef.current = () => setIsModalOpen(false);

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

  useEffect(() => {
    modalOnCloseRef.current = closeModal;
  }, [closeModal]);

  if (!isModalOpen) {
    return null;
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Insert Video</DialogTitle>
        </DialogHeader>
        <InsertVideoDialog activeEditor={editor} onClose={closeModal} />
      </DialogContent>
    </Dialog>
  );
}
