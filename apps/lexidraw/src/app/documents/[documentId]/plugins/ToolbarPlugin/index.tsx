import { $isCodeNode, CODE_LANGUAGE_MAP } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isDecoratorBlockNode } from "@lexical/react/LexicalDecoratorBlockNode";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $getSelectionStyleValueForProperty,
  $isParentElementRTL,
  $patchStyleText,
} from "@lexical/selection";
import { $isTableNode, $isTableSelection } from "@lexical/table";
import {
  $findMatchingParent,
  $getNearestBlockElementAncestorOrThrow,
  $getNearestNodeOfType,
  mergeRegister,
} from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  ElementFormatType,
  FORMAT_TEXT_COMMAND,
  KEY_MODIFIER_COMMAND,
  NodeKey,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { Dispatch, useCallback, useEffect, useState, type JSX } from "react";
import { IS_APPLE } from "../../shared/environment";
import { ColorPickerButton } from "~/components/ui/color-picker";
import { useGetSelectedNode } from "../../utils/getSelectedNode";
import { useSanitizeUrl } from "../../utils/url";
import FontSize from "./font-size";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import {
  Baseline,
  Bold,
  Code,
  Italic,
  Link,
  BotMessageSquare,
  PaintBucket,
  Redo,
  Underline,
  Undo,
} from "lucide-react";
import { TooltipButton } from "~/components/ui/tooltip-button";
import Ellipsis from "~/components/icons/ellipsis";
import { Tooltip, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useSidebarManager } from "~/context/sidebar-manager-context";
import { MessageSquareText, ListTree } from "lucide-react";
import { useToolbarUtils } from "./utils";
import { FontDropDown } from "./font";
import {
  blockTypeToBlockName,
  rootTypeToRootName,
} from "../../context/toolbar-context";
import { BlockFormatDropDown, BlockType } from "./block-format";
import { LlmModelSelector } from "./llm-config";
import { ElementFormatDropdown } from "./element-format";
import { Divider } from "./divider";
import { CodeSelector } from "./code-selector";
import { InsertItem } from "./insert-item";
import { SettingsDropdown } from "./settings-dropdown";

export default function ToolbarPlugin({
  setIsLinkEditMode,
}: {
  setIsLinkEditMode: Dispatch<boolean>;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [activeEditor, setActiveEditor] = useState(editor);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [rootType, setRootType] =
    useState<keyof typeof rootTypeToRootName>("root");
  const [selectedElementKey, setSelectedElementKey] = useState<NodeKey | null>(
    null,
  );
  const { dropDownActiveClass } = useToolbarUtils();
  const getSelectedNode = useGetSelectedNode();
  const [fontSize, setFontSize] = useState<string>("15px");
  const [fontColor, setFontColor] = useState<string>("#000");
  const [bgColor, setBgColor] = useState<string>("#fff");
  const [fontFamily, setFontFamily] = useState<string>("Fredoka");
  const [elementFormat, setElementFormat] = useState<ElementFormatType>("left");
  const [isLink, setIsLink] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isSubscript, setIsSubscript] = useState(false);
  const [isSuperscript, setIsSuperscript] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isRTL, setIsRTL] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<string>("");
  const [isEditable, setIsEditable] = useState(() => activeEditor.isEditable());

  const { activeSidebar, toggleSidebar } = useSidebarManager();

  const sanitizeUrl = useSanitizeUrl();

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      let element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : $findMatchingParent(anchorNode, (e) => {
              const parent = e.getParent();
              return parent !== null && $isRootOrShadowRoot(parent);
            });

      if (element === null) {
        element = anchorNode.getTopLevelElementOrThrow();
      }

      const elementKey = element.getKey();
      const elementDOM = activeEditor.getElementByKey(elementKey);

      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsSubscript(selection.hasFormat("subscript"));
      setIsSuperscript(selection.hasFormat("superscript"));
      setIsCode(selection.hasFormat("code"));
      setIsRTL($isParentElementRTL(selection));

      // Update links
      const node = getSelectedNode(selection);
      const parent = node.getParent();
      if ($isLinkNode(parent) || $isLinkNode(node)) {
        setIsLink(true);
      } else {
        setIsLink(false);
      }

      const tableNode = $findMatchingParent(node, $isTableNode);
      if ($isTableNode(tableNode)) {
        setRootType("table");
      } else {
        setRootType("root");
      }

      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType<ListNode>(
            anchorNode,
            ListNode,
          );
          const type = parentList
            ? parentList.getListType()
            : element.getListType();
          setBlockType(type);
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          if (type in blockTypeToBlockName) {
            setBlockType(type as BlockType);
          }
          if ($isCodeNode(element)) {
            const language =
              element.getLanguage() as keyof typeof CODE_LANGUAGE_MAP;
            setCodeLanguage(
              language ? CODE_LANGUAGE_MAP[language] || language : "",
            );
            return;
          }
        }
      }
      // Handle buttons
      setFontColor(
        $getSelectionStyleValueForProperty(selection, "color", "#000"),
      );
      setBgColor(
        $getSelectionStyleValueForProperty(
          selection,
          "background-color",
          "#fff",
        ),
      );
      setFontFamily(
        $getSelectionStyleValueForProperty(selection, "font-family", "Fredoka"),
      );
      let matchingParent;
      if ($isLinkNode(parent)) {
        // If node is a link, we need to fetch the parent paragraph node to set format
        matchingParent = $findMatchingParent(
          node,
          (parentNode) => $isElementNode(parentNode) && !parentNode.isInline(),
        );
      }

      // If matchingParent is a valid node, pass it's format type
      setElementFormat(
        $isElementNode(matchingParent)
          ? matchingParent.getFormatType()
          : $isElementNode(node)
            ? node.getFormatType()
            : parent?.getFormatType() || "left",
      );
    }
    if ($isRangeSelection(selection) || $isTableSelection(selection)) {
      setFontSize(
        $getSelectionStyleValueForProperty(selection, "font-size", "15px"),
      );
    }
  }, [activeEditor, getSelectedNode]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditorInstance) => {
        if (activeEditor !== newEditorInstance) {
          setActiveEditor(newEditorInstance);
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, activeEditor, setActiveEditor]);

  useEffect(() => {
    return mergeRegister(
      activeEditor.registerEditableListener((editable) => {
        setIsEditable(editable);
      }),
      activeEditor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      activeEditor.registerCommand<boolean>(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      activeEditor.registerCommand<boolean>(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [$updateToolbar, activeEditor]);

  useEffect(() => {
    return activeEditor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (payload) => {
        const event: KeyboardEvent = payload;
        const { code, ctrlKey, metaKey } = event;

        if (code === "KeyK" && (ctrlKey || metaKey)) {
          event.preventDefault();
          let url: string | null;
          if (!isLink) {
            setIsLinkEditMode(true);
            url = sanitizeUrl("https://");
          } else {
            setIsLinkEditMode(false);
            url = null;
          }
          return activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [activeEditor, isLink, sanitizeUrl, setIsLinkEditMode]);

  const applyStyleText = useCallback(
    (styles: Record<string, string>, skipHistoryStack?: boolean) => {
      activeEditor.update(
        () => {
          const selection = $getSelection();
          if (selection !== null) {
            $patchStyleText(selection, styles);
          }
        },
        skipHistoryStack ? { tag: "historic" } : {},
      );
    },
    [activeEditor],
  );

  const clearFormatting = useCallback(() => {
    activeEditor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection) || $isTableSelection(selection)) {
        const anchor = selection.anchor;
        const focus = selection.focus;
        const nodes = selection.getNodes();
        const extractedNodes = selection.extract();

        if (anchor.key === focus.key && anchor.offset === focus.offset) {
          return;
        }

        nodes.forEach((node, idx) => {
          // We split the first and last node by the selection
          // So that we don't format unselected text inside those nodes
          if ($isTextNode(node)) {
            // Use a separate variable to ensure TS does not lose the refinement
            let textNode = node;
            if (idx === 0 && anchor.offset !== 0) {
              textNode = textNode.splitText(anchor.offset)[1] || textNode;
            }
            if (idx === nodes.length - 1) {
              textNode = textNode.splitText(focus.offset)[0] || textNode;
            }
            /**
             * If the selected text has one format applied
             * selecting a portion of the text, could
             * clear the format to the wrong portion of the text.
             *
             * The cleared text is based on the length of the selected text.
             */
            // We need this in case the selected text only has one format
            const extractedTextNode = extractedNodes[0];
            if (nodes.length === 1 && $isTextNode(extractedTextNode)) {
              textNode = extractedTextNode;
            }

            if (textNode.__style !== "") {
              textNode.setStyle("");
            }
            if (textNode.__format !== 0) {
              textNode.setFormat(0);
              $getNearestBlockElementAncestorOrThrow(textNode).setFormat("");
            }
            node = textNode;
          } else if ($isHeadingNode(node) || $isQuoteNode(node)) {
            node.replace($createParagraphNode(), true);
          } else if ($isDecoratorBlockNode(node)) {
            node.setFormat("");
          }
        });
      }
    });
  }, [activeEditor]);

  const onFontColorSelect = useCallback(
    (value: string, skipHistoryStack: boolean) => {
      applyStyleText({ color: value }, skipHistoryStack);
    },
    [applyStyleText],
  );

  const onBgColorSelect = useCallback(
    (value: string, skipHistoryStack: boolean) => {
      applyStyleText({ "background-color": value }, skipHistoryStack);
    },
    [applyStyleText],
  );

  const insertLink = useCallback(() => {
    if (!isLink) {
      setIsLinkEditMode(true);
      activeEditor.dispatchCommand(
        TOGGLE_LINK_COMMAND,
        sanitizeUrl("https://"),
      );
    } else {
      setIsLinkEditMode(false);
      activeEditor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    }
  }, [activeEditor, isLink, sanitizeUrl, setIsLinkEditMode]);

  return (
    <div className="flex flex-nowrap md:flex-wrap gap-2 overflow-x-auto md:overflow-visible top-0">
      {/* Undo/Redo */}
      <div className="flex" role="group" aria-label="History actions">
        <TooltipButton
          onClick={() => {
            activeEditor.dispatchCommand(UNDO_COMMAND, undefined);
          }}
          className="w-10 md:w-8 h-12 md:h-10 rounded-r-none"
          disabled={!canUndo || !isEditable}
          title={IS_APPLE ? "Undo (⌘Z)" : "Undo (Ctrl+Z)"}
          Icon={Undo}
          ariaLabel="Undo"
        />
        <TooltipButton
          onClick={() => {
            activeEditor.dispatchCommand(REDO_COMMAND, undefined);
          }}
          className="w-10 md:w-8 h-12 md:h-10 rounded-l-none"
          disabled={!canRedo || !isEditable}
          title={IS_APPLE ? "Redo (⌘Y)" : "Redo (Ctrl+Y)"}
          Icon={Redo}
          ariaLabel="Redo"
        />
      </div>

      <Divider />

      {blockType === "code" ? (
        <>
          <CodeSelector
            activeEditor={activeEditor}
            selectedElementKey={selectedElementKey}
            isEditable={isEditable}
            codeLanguage={codeLanguage}
          />
          <Divider />
        </>
      ) : (
        <>
          <div className="flex gap-0 h-12 md:h-10">
            <ElementFormatDropdown
              disabled={!isEditable}
              value={elementFormat}
              editor={activeEditor}
              isRTL={isRTL}
              className="rounded-r-none border-r-0"
            />
            <BlockFormatDropDown
              disabled={!isEditable}
              blockType={blockType}
              rootType={rootType}
              editor={activeEditor}
              className="rounded-none border-x-0"
            />
            <FontDropDown
              disabled={!isEditable}
              style={"font-family"}
              value={fontFamily}
              editor={activeEditor}
              className="rounded-l-none border-l-0"
            />
          </div>
          <Divider />
          <div
            className="flex"
            role="group"
            aria-label="Font style and basic formatting"
          >
            <FontSize
              selectionFontSize={fontSize.slice(0, -2)}
              editor={activeEditor}
              disabled={!isEditable}
              className=""
            />
            <TooltipButton
              onClick={() => {
                activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
              }}
              className={cn(
                "w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0",
                { "bg-muted": isBold },
              )}
              disabled={!isEditable}
              title={IS_APPLE ? "Bold (⌘B)" : "Bold (Ctrl+B)"}
              Icon={Bold}
              ariaLabel={`Format text as bold. Shortcut: ${IS_APPLE ? "⌘B" : "Ctrl+B"}`}
            />
            <TooltipButton
              onClick={() => {
                activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
              }}
              className={cn(
                "w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0",
                { "bg-muted": isItalic },
              )}
              disabled={!isEditable}
              title={IS_APPLE ? "Italic (⌘I)" : "Italic (Ctrl+I)"}
              Icon={Italic}
              ariaLabel={`Format text as italics. Shortcut: ${IS_APPLE ? "⌘I" : "Ctrl+I"}`}
            />
            <TooltipButton
              onClick={() => {
                activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
              }}
              className={cn(
                "w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0",
                { "bg-muted": isUnderline },
              )}
              disabled={!isEditable}
              title={IS_APPLE ? "Underline (⌘U)" : "Underline (Ctrl+U)"}
              Icon={Underline}
              ariaLabel={`Format text to underlined. Shortcut: ${IS_APPLE ? "⌘U" : "Ctrl+U"}`}
            />
            {/* Text Color / Background Color */}
            <div className="flex" role="group" aria-label="Color formatting">
              <ColorPickerButton
                disabled={!isEditable}
                buttonAriaLabel="Formatting text color"
                color={fontColor}
                onChange={onFontColorSelect}
                title="Text color"
                Icon={Baseline}
                className="rounded-none border-x-0"
              />
              <ColorPickerButton
                disabled={!isEditable}
                buttonAriaLabel="Formatting background color"
                color={bgColor}
                onChange={onBgColorSelect}
                title="Background color"
                Icon={PaintBucket}
                className="rounded-none border-x-0"
              />
            </div>
            <Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={!isEditable}
                      aria-label="Formatting options for additional text styles"
                      className="w-10 md:w-8 h-12 md:h-10 p-1 rounded-l-none rounded-r-md border-l-0"
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </TooltipTrigger>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() => {
                      activeEditor.dispatchCommand(
                        FORMAT_TEXT_COMMAND,
                        "strikethrough",
                      );
                    }}
                    className={"item " + dropDownActiveClass(isStrikethrough)}
                    title="Strikethrough"
                    aria-label="Format text with a strikethrough"
                  >
                    <i className="icon strikethrough" />
                    <span className="text">Strikethrough</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      activeEditor.dispatchCommand(
                        FORMAT_TEXT_COMMAND,
                        "subscript",
                      );
                    }}
                    className={"item " + dropDownActiveClass(isSubscript)}
                    title="Subscript"
                    aria-label="Format text with a subscript"
                  >
                    <i className="icon subscript" />
                    <span className="text">Subscript</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      activeEditor.dispatchCommand(
                        FORMAT_TEXT_COMMAND,
                        "superscript",
                      );
                    }}
                    className={"item " + dropDownActiveClass(isSuperscript)}
                    title="Superscript"
                    aria-label="Format text with a superscript"
                  >
                    <i className="icon superscript" />
                    <span className="text">Superscript</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={clearFormatting}
                    className="item"
                    title="Clear text formatting"
                    aria-label="Clear all text formatting"
                  >
                    <i className="icon clear" />
                    <span className="text">Clear Formatting</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </div>
          <Divider />

          <div className="flex gap-0 h-12 md:h-10">
            <InsertItem activeEditor={activeEditor} isEditable={isEditable} />
            <TooltipButton
              onClick={() => {
                activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
              }}
              className={cn(
                "w-10 md:w-8 h-12 md:h-10 border-x-0 rounded-none",
                {
                  "bg-muted": isCode,
                },
              )}
              disabled={!isEditable}
              title="Insert code block"
              Icon={Code}
              ariaLabel="Insert code block"
            />
            <TooltipButton
              className={cn(
                "w-10 md:w-8 h-12 md:h-10 border-l-0 rounded-l-none",
                {
                  "bg-muted": isLink,
                },
              )}
              onClick={insertLink}
              disabled={!isEditable}
              title="Insert link"
              Icon={Link}
              ariaLabel="Insert link"
            />
          </div>
        </>
      )}
      <Divider />

      {/* AI Config / LLM Chat / Comments / TOC */}
      <div className="flex" role="group" aria-label="AI and sidebar controls">
        <LlmModelSelector className="rounded-r-none border-r-0" />
        <TooltipButton
          className={cn("w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0", {
            "bg-muted": activeSidebar === "llm",
          })}
          disabled={!isEditable}
          onClick={() => toggleSidebar("llm")}
          ariaLabel="Toggle LLM Chat"
          title="AI Assistant"
          Icon={BotMessageSquare}
        />
        <TooltipButton
          className={cn("w-10 md:w-8 h-12 md:h-10 rounded-none border-x-0", {
            "bg-muted": activeSidebar === "comments",
          })}
          disabled={!isEditable}
          onClick={() => toggleSidebar("comments")}
          ariaLabel="Toggle Comments"
          title="Comments"
          Icon={MessageSquareText}
        />
        <TooltipButton
          className={cn(
            "w-10 md:w-8 h-12 md:h-10 rounded-l-none rounded-r-md border-l-0",
            { "bg-muted": activeSidebar === "toc" },
          )}
          disabled={!isEditable}
          onClick={() => toggleSidebar("toc")}
          ariaLabel="Toggle Table of Contents"
          title="Table of Contents"
          Icon={ListTree}
        />
      </div>
      <Divider />
      <SettingsDropdown className="rounded-md" />
    </div>
  );
}
