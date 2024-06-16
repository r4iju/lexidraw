"use client";

import { debounce } from "@packages/lib";
import { TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { MarkNode } from "@lexical/mark";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { Theme } from "./_themes/themes";
import ToolbarPlugin from "./_plugins/toolbar-plugin";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { useCallback, useEffect, useRef, useState } from "react";
import OptionsDropdown from "./_plugins/options-dropdown";
import { EditorState, createEditor } from "lexical";
import { CodeNode } from "@lexical/code";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { RouterOutputs } from "~/trpc/shared";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import { MessageStructure } from "@packages/types";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

// import { CodeNode } from "./_plugins/custom-code-node";

type EditorProps = {
  revalidate: () => void;
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
};

function EditorHandler({ revalidate, entity, iceServers }: EditorProps) {
  const editorStateRef = useRef<EditorState>();
  const canCollaborate =
    entity.sharedWith.length > 0 || entity.publicAccess !== "private";
  const userId = useUserIdOrGuestId();
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [editor] = useLexicalComposerContext();

  const debouncedSendUpdateRef = useRef(
    debounce((parsedState: string) => {
      sendMessage({
        type: "update",
        entityId: entity.id,
        userId,
        entityType: "document",
        payload: {
          elements: parsedState,
        },
      });
    }, 100),
  );

  const onChange = (editorState: EditorState) => {
    if (isRemoteUpdate) return;
    const parsedState = JSON.stringify(editorState);
    if (parsedState === JSON.stringify(editorStateRef.current)) {
      return;
    }
    editorStateRef.current = editorState;
    debouncedSendUpdateRef.current(parsedState);
  };

  const applyUpdate = useCallback(
    (message: MessageStructure) => {
      if (message.entityType === "document") {
        setIsRemoteUpdate(true);
        const editorState = editor.parseEditorState(message.payload.elements);
        editorStateRef.current = editorState;
        editor.setEditorState(editorState);
        setIsRemoteUpdate(false);
      }
    },
    [editorStateRef],
  );

  const { sendMessage, initializeConnection, closeConnection, peers } =
    useWebRtcService(
      {
        drawingId: entity.id,
        userId,
        iceServers,
      },
      {
        onMessage: applyUpdate,
        onConnectionClose: () => setIsCollaborating(false),
        onConnectionOpen: () => setIsCollaborating(true),
      },
    );

  useEffect(() => {
    if (!isCollaborating && canCollaborate) {
      initializeConnection()
        .then(() => {
          console.log("connection initialized");
        })
        .catch((err) => {
          console.error("error initializing connection", err);
        });
    }
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      revalidate();
      closeConnection(true);
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Toolbar with semi-transparent background floating over the content */}
      <div className="fixed top-0 left-0 right-0 z-10 w-full">
        <div className="flex justify-center md:justify-between md:px-8 items-center py-2 max-w-screen-lg mx-auto">
          <OptionsDropdown
            className="hidden md:flex"
            documentId={entity.id}
            state={editorStateRef}
          />
          <ToolbarPlugin />
          <ModeToggle className="hidden md:flex" />
        </div>
      </div>
      {/* bottom left options */}

      <OptionsDropdown
        className=" fixed bottom-2 left-2 z-10 md:hidden"
        documentId={entity.id}
        state={editorStateRef}
      />

      {/* ContentEditable allowing content to scroll behind the toolbar */}
      <div className="w-full h-full overflow-y-auto max-w-screen-lg border-x border-x-zinc-200 mx-auto">
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              id="lexical-content"
              className="resize-none outline-none pt-20 px-6 text-black dark:text-white "
            />
          }
          placeholder={<Placeholder />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={onChange} />
        <HistoryPlugin />
        <AutoFocusPlugin />
      </div>
    </div>
  );
}

function Placeholder() {
  return (
    <div className="px-6 text-gray-600 mt-[-32px] dark:text-gray-100 select-none pointer-events-none">
      Enter some rich text...
    </div>
  );
}

type Props = {
  revalidate: () => void;
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
};

export default function DocumentEditor({
  revalidate,
  entity,
  iceServers,
}: Props) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "Excalifork",
        editorState: entity.elements,
        onError: (error) => {
          console.error("Error in LexicalComposer: ", error);
        },
        nodes: [
          HeadingNode,
          QuoteNode,
          LinkNode,
          ListItemNode,
          ListNode,
          HorizontalRuleNode,
          MarkNode,
          CodeNode,
        ],
        theme: Theme,
      }}
    >
      <EditorHandler
        revalidate={revalidate}
        entity={entity}
        iceServers={iceServers}
      />
    </LexicalComposer>
  );
}
