import { $isCodeNode } from "@lexical/code";
import { normalizeCodeLanguage } from "@lexical/code-shiki";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
} from "@lexical/selection";
import { $isTableNode, $isTableSelection } from "@lexical/table";
import {
  $findMatchingParent,
  $getNearestNodeOfType,
  mergeRegister,
} from "@lexical/utils";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  type ElementFormatType,
  FORMAT_TEXT_COMMAND,
  KEY_MODIFIER_COMMAND,
  type LexicalNode,
  type NodeKey,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  Baseline,
  Blocks,
  Bold,
  Bug,
  Code,
  Headphones,
  Highlighter,
  Italic,
  Link,
  type LucideIcon,
  Redo,
  RemoveFormatting,
  Sparkles,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo,
} from "lucide-react";
import {
  type Dispatch,
  type JSX,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  ColorPickerButton,
  HIGHLIGHT_PRESETS,
  TEXT_COLOUR_PRESETS,
} from "~/components/ui/color-picker";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "~/components/ui/dropdown-menu";
import { useLayoutClass } from "~/hooks/use-media-query";
import useModal from "~/hooks/useModal";
import { useDeveloperFlag } from "~/lib/developer-flag";
import { useDocumentSettings } from "../../context/document-settings-context";
import { useSignedIn } from "../../context/signed-in-context";
import type { rootTypeToRootName } from "../../context/toolbar-context";
import { IS_APPLE } from "../../shared/environment";
import { useGetSelectedNode } from "../../utils/getSelectedNode";
import { useSanitizeUrl } from "../../utils/url";
import { ListenControls, ListenItems } from "../TtsToolbar";
import { AiItems, AiMenu, DeveloperItems, DeveloperMenu } from "./ai-menu";
import { $blockTypeOf, BlockActionItems } from "./block-actions";
import {
  BlockFormatDropDown,
  type BlockType,
  BlockTypeItems,
  blockTypeLabel,
} from "./block-format";
import { CodeLanguageItems, CodeSelector } from "./code-selector";
import { AlignItems, ElementFormatDropdown } from "./element-format";
import { FontDropDown, FontItems } from "./font";
import FontSize from "./font-size";
import { InsertItems, InsertMenu } from "./insert-item";
import { ColourItems, MoreSub, ShortcutHint } from "./menu-parts";
import { PhoneBar } from "./phone-bar";
import {
  Toolbar,
  ToolbarButton,
  type ToolbarGroup,
  ToolbarMenu,
} from "./toolbar";
import { useToolbarUtils } from "./utils";

const MARKS: {
  format: TextFormatType;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}[] = [
  { format: "bold", label: "Bold", icon: Bold, shortcut: "Mod+B" },
  { format: "italic", label: "Italic", icon: Italic, shortcut: "Mod+I" },
  {
    format: "underline",
    label: "Underline",
    icon: Underline,
    shortcut: "Mod+U",
  },
  {
    format: "strikethrough",
    label: "Strikethrough",
    icon: Strikethrough,
    shortcut: "Mod+Shift+S",
  },
];

const SCRIPTS: typeof MARKS = [
  {
    format: "subscript",
    label: "Subscript",
    icon: Subscript,
    shortcut: "Mod+,",
  },
  {
    format: "superscript",
    label: "Superscript",
    icon: Superscript,
    shortcut: "Mod+.",
  },
];

const REDO_SHORTCUT = IS_APPLE ? "Mod+Shift+Z" : "Mod+Y";

export default function ToolbarPlugin({
  setIsLinkEditMode,
  className,
}: {
  setIsLinkEditMode: Dispatch<boolean>;
  className?: string;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const signedIn = useSignedIn();
  const developer = useDeveloperFlag();
  // A phone edits from a bar above its keyboard instead.
  const phone = useLayoutClass() === "phone";
  const [activeEditor, setActiveEditor] = useState(editor);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [rootType, setRootType] =
    useState<keyof typeof rootTypeToRootName>("root");
  const [selectedElementKey, setSelectedElementKey] = useState<NodeKey | null>(
    null,
  );
  const getSelectedNode = useGetSelectedNode();
  const { defaultFontFamily } = useDocumentSettings();
  const { clearFormatting } = useToolbarUtils();
  const [modal, showModal] = useModal();
  const [fontSize, setFontSize] = useState<string>("16px");
  const [fontColor, setFontColor] = useState<string>("");
  const [bgColor, setBgColor] = useState<string>("");
  const [fontFamily, setFontFamily] = useState<string>("");
  const [elementFormat, setElementFormat] = useState<ElementFormatType>("left");
  const [isLink, setIsLink] = useState(false);
  const [formats, setFormats] = useState<Set<TextFormatType>>(new Set());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isRTL, setIsRTL] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState<string>("");
  const [isEditable, setIsEditable] = useState(() => activeEditor.isEditable());

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

      setFormats(
        new Set(
          [...MARKS, ...SCRIPTS, { format: "code" as const }]
            .map(({ format }) => format)
            .filter((format) => selection.hasFormat(format)),
        ),
      );
      // Lexical >=0.35 requires an active editor when reading computed styles
      // Determine RTL from the root element direction to avoid relying on editor state
      const rootEl = activeEditor.getRootElement();
      if (rootEl) {
        const dirAttr = rootEl.getAttribute("dir");
        const dir = dirAttr || window.getComputedStyle(rootEl).direction;
        setIsRTL(dir === "rtl");
      }

      const node = getSelectedNode(selection);
      const parent = node.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(node));

      const tableNode = $findMatchingParent(node, $isTableNode);
      setRootType($isTableNode(tableNode) ? "table" : "root");

      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType<ListNode>(
            anchorNode,
            ListNode,
          );
          setBlockType(
            parentList ? parentList.getListType() : element.getListType(),
          );
        } else {
          const type = $blockTypeOf(element);
          if (type) setBlockType(type);
          if ($isCodeNode(element)) {
            const language = element.getLanguage();
            setCodeLanguage(language ? normalizeCodeLanguage(language) : "");
            return;
          }
        }
      }
      setFontColor($getSelectionStyleValueForProperty(selection, "color", ""));
      setBgColor(
        $getSelectionStyleValueForProperty(selection, "background-color", ""),
      );
      setFontFamily(
        $getSelectionStyleValueForProperty(selection, "font-family", ""),
      );
      let matchingParent: LexicalNode | null = null;
      if ($isLinkNode(parent)) {
        // A link's format is its paragraph's.
        matchingParent = $findMatchingParent(
          node,
          (parentNode) => $isElementNode(parentNode) && !parentNode.isInline(),
        );
      }

      setElementFormat(
        $isElementNode(matchingParent)
          ? matchingParent.getFormatType()
          : $isElementNode(node)
            ? node.getFormatType()
            : parent?.getFormatType() || "left",
      );
    }
    if ($isRangeSelection(selection)) {
      const anchorElement = activeEditor.getElementByKey(selection.anchor.key);
      const renderedSize = anchorElement
        ? getComputedStyle(anchorElement).fontSize
        : "16px";
      setFontSize(
        $getSelectionStyleValueForProperty(
          selection,
          "font-size",
          renderedSize,
        ),
      );
    } else if ($isTableSelection(selection)) {
      // Table selections don't carry inline font-size; keep/default
      setFontSize("16px");
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
  }, [editor, activeEditor]);

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

  const toggleLink = useCallback(() => {
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

  useEffect(() => {
    return activeEditor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.code === "KeyK" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          toggleLink();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [activeEditor, toggleLink]);

  const applyStyleText = useCallback(
    (styles: Record<string, string | null>, skipHistoryStack?: boolean) => {
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

  const onFontColorSelect = useCallback(
    (value: string, skipHistoryStack: boolean) => {
      applyStyleText({ color: value === "" ? null : value }, skipHistoryStack);
    },
    [applyStyleText],
  );

  const onBgColorSelect = useCallback(
    (value: string, skipHistoryStack: boolean) => {
      applyStyleText(
        { "background-color": value === "" ? null : value },
        skipHistoryStack,
      );
    },
    [applyStyleText],
  );

  const inCode = blockType === "code";
  const format = (value: TextFormatType) =>
    activeEditor.dispatchCommand(FORMAT_TEXT_COMMAND, value);
  const formatItems = (marks: typeof MARKS) =>
    marks.map(({ format: value, label, icon: Icon, shortcut }) => (
      <DropdownMenuCheckboxItem
        key={value}
        checked={formats.has(value)}
        disabled={inCode}
        onCheckedChange={() => format(value)}
      >
        <Icon className="mr-2 size-4" />
        {label}
        <ShortcutHint shortcut={shortcut} />
      </DropdownMenuCheckboxItem>
    ));
  const formatButtons = (marks: typeof MARKS) =>
    marks.map(({ format: value, label, icon, shortcut }) => (
      <ToolbarButton
        key={value}
        label={label}
        shortcut={shortcut}
        icon={icon}
        pressed={formats.has(value)}
        disabled={inCode}
        onClick={() => format(value)}
      />
    ));
  const fontValue = fontFamily || defaultFontFamily || "sans";

  const editing: ToolbarGroup[] = [
    {
      id: "history",
      label: "History",
      content: (
        <>
          <ToolbarButton
            label="Undo"
            shortcut="Mod+Z"
            icon={Undo}
            disabled={!canUndo}
            onClick={() =>
              activeEditor.dispatchCommand(UNDO_COMMAND, undefined)
            }
          />
          <ToolbarButton
            label="Redo"
            shortcut={REDO_SHORTCUT}
            icon={Redo}
            disabled={!canRedo}
            onClick={() =>
              activeEditor.dispatchCommand(REDO_COMMAND, undefined)
            }
          />
        </>
      ),
      menu: (
        <>
          <DropdownMenuItem
            className="gap-2"
            disabled={!canUndo}
            onSelect={() =>
              activeEditor.dispatchCommand(UNDO_COMMAND, undefined)
            }
          >
            <Undo className="size-4" />
            Undo
            <ShortcutHint shortcut="Mod+Z" />
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={!canRedo}
            onSelect={() =>
              activeEditor.dispatchCommand(REDO_COMMAND, undefined)
            }
          >
            <Redo className="size-4" />
            Redo
            <ShortcutHint shortcut={REDO_SHORTCUT} />
          </DropdownMenuItem>
        </>
      ),
    },
    {
      id: "block-type",
      label: "Block type",
      content: (
        <BlockFormatDropDown
          blockType={blockType}
          rootType={rootType}
          editor={activeEditor}
        />
      ),
      menu: (
        <MoreSub label="Block type" icon={blockTypeLabel(blockType).icon}>
          <BlockTypeItems editor={activeEditor} blockType={blockType} />
        </MoreSub>
      ),
    },
    {
      id: "marks",
      label: "Text style",
      content: formatButtons(MARKS),
      menu: formatItems(MARKS),
    },
    {
      id: "inline",
      label: "Code and link",
      content: (
        <>
          <ToolbarButton
            label="Inline code"
            shortcut="Mod+Shift+C"
            icon={Code}
            pressed={formats.has("code")}
            disabled={inCode}
            onClick={() => format("code")}
          />
          <ToolbarButton
            label="Link"
            shortcut="Mod+K"
            icon={Link}
            pressed={isLink}
            disabled={inCode}
            onClick={toggleLink}
          />
        </>
      ),
      menu: (
        <>
          <DropdownMenuCheckboxItem
            checked={formats.has("code")}
            disabled={inCode}
            onCheckedChange={() => format("code")}
          >
            <Code className="mr-2 size-4" />
            Inline code
            <ShortcutHint shortcut="Mod+Shift+C" />
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={isLink}
            disabled={inCode}
            onCheckedChange={toggleLink}
          >
            <Link className="mr-2 size-4" />
            Link
            <ShortcutHint shortcut="Mod+K" />
          </DropdownMenuCheckboxItem>
        </>
      ),
    },
    {
      id: "insert",
      label: "Insert",
      content: <InsertMenu editor={activeEditor} showModal={showModal} />,
      menu: (
        <MoreSub label="Insert">
          <InsertItems editor={activeEditor} showModal={showModal} />
        </MoreSub>
      ),
    },
    {
      id: "colour",
      label: "Colour",
      content: (
        <>
          <ColorPickerButton
            title="Text colour"
            color={fontColor}
            presets={TEXT_COLOUR_PRESETS}
            onChange={onFontColorSelect}
            Icon={Baseline}
            disabled={inCode}
          />
          <ColorPickerButton
            title="Highlight"
            color={bgColor}
            presets={HIGHLIGHT_PRESETS}
            onChange={onBgColorSelect}
            Icon={Highlighter}
            disabled={inCode}
          />
        </>
      ),
      menu: (
        <>
          <MoreSub label="Text colour" icon={Baseline} disabled={inCode}>
            <ColourItems
              value={fontColor}
              presets={TEXT_COLOUR_PRESETS}
              onChange={onFontColorSelect}
            />
          </MoreSub>
          <MoreSub label="Highlight" icon={Highlighter} disabled={inCode}>
            <ColourItems
              value={bgColor}
              presets={HIGHLIGHT_PRESETS}
              onChange={onBgColorSelect}
            />
          </MoreSub>
        </>
      ),
    },
    {
      id: "align",
      label: "Alignment",
      content: (
        <ElementFormatDropdown
          value={elementFormat}
          editor={activeEditor}
          isRTL={isRTL}
        />
      ),
      menu: (
        <MoreSub label="Align">
          <AlignItems
            editor={activeEditor}
            value={elementFormat}
            isRTL={isRTL}
          />
        </MoreSub>
      ),
    },
    {
      id: "font",
      label: inCode ? "Code language" : "Font",
      content: inCode ? (
        <>
          <CodeSelector
            editor={activeEditor}
            selectedElementKey={selectedElementKey}
            codeLanguage={codeLanguage}
          />
          <FontSize
            selectionFontSize={fontSize.slice(0, -2)}
            editor={activeEditor}
            disabled
          />
        </>
      ) : (
        <>
          <FontDropDown
            value={fontValue}
            editor={activeEditor}
            showModal={showModal}
          />
          <FontSize
            selectionFontSize={fontSize.slice(0, -2)}
            editor={activeEditor}
          />
        </>
      ),
      menu: inCode ? (
        <MoreSub label="Code language">
          <CodeLanguageItems
            editor={activeEditor}
            selectedElementKey={selectedElementKey}
            codeLanguage={codeLanguage}
          />
        </MoreSub>
      ) : (
        <MoreSub label="Font">
          <FontItems
            editor={activeEditor}
            value={fontValue}
            showModal={showModal}
          />
        </MoreSub>
      ),
    },
    {
      id: "script",
      label: "Script and clearing",
      content: (
        <>
          {formatButtons(SCRIPTS)}
          <ToolbarButton
            label="Clear formatting"
            shortcut="Mod+\"
            icon={RemoveFormatting}
            disabled={inCode}
            onClick={() => clearFormatting(activeEditor)}
          />
        </>
      ),
      menu: (
        <>
          {formatItems(SCRIPTS)}
          <DropdownMenuItem
            className="gap-2"
            disabled={inCode}
            onSelect={() => clearFormatting(activeEditor)}
          >
            <RemoveFormatting className="size-4" />
            Clear formatting
            <ShortcutHint shortcut="Mod+\" />
          </DropdownMenuItem>
        </>
      ),
    },
  ];

  const groups: ToolbarGroup[] = isEditable ? [...editing] : [];
  if (isEditable)
    groups.push({
      id: "block",
      label: "Block",
      content: (
        <ToolbarMenu label="Block" icon={Blocks}>
          <BlockActionItems editor={activeEditor} blockType={blockType} />
        </ToolbarMenu>
      ),
      menu: (
        <MoreSub label="Block" icon={Blocks}>
          <BlockActionItems editor={activeEditor} blockType={blockType} />
        </MoreSub>
      ),
    });
  if (isEditable && signedIn)
    groups.push({
      id: "ai",
      label: "AI",
      content: <AiMenu />,
      menu: (
        <MoreSub label="AI" icon={Sparkles}>
          <AiItems />
        </MoreSub>
      ),
    });
  // A reader listens from the reading pill instead.
  if (isEditable && signedIn)
    groups.push({
      id: "listen",
      label: "Listen",
      content: <ListenControls />,
      menu: (
        <MoreSub label="Listen" icon={Headphones}>
          <ListenItems withPlay />
        </MoreSub>
      ),
    });
  if (developer)
    groups.push({
      id: "developer",
      label: "Developer tools",
      content: <DeveloperMenu />,
      menu: (
        <MoreSub label="Developer tools" icon={Bug}>
          <DeveloperItems />
        </MoreSub>
      ),
    });

  if (phone)
    return (
      <>
        {isEditable && (
          <PhoneBar
            editor={activeEditor}
            formats={formats}
            inCode={inCode}
            isLink={isLink}
            toggleLink={toggleLink}
            blockType={blockType}
            canUndo={canUndo}
            canRedo={canRedo}
            fontValue={fontValue}
            fontSize={fontSize}
            fontColor={fontColor}
            bgColor={bgColor}
            onFontColorSelect={onFontColorSelect}
            onBgColorSelect={onBgColorSelect}
            elementFormat={elementFormat}
            isRTL={isRTL}
            signedIn={signedIn}
            showModal={showModal}
          />
        )}
        {modal}
      </>
    );
  return (
    <>
      <Toolbar label="Formatting" groups={groups} className={className} />
      {modal}
    </>
  );
}
