"use client";
import { useTheme } from "next-themes";
import { useEffect, useState, Suspense } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { CodeHighlightNode } from "@lexical/code";
import { DocumentCodeNode } from "@packages/lexical-nodes";
import { ArticleContent } from "../documents/[documentId]/nodes/ArticleNode/ArticleContent";
import MermaidImage from "../documents/[documentId]/nodes/MermaidNode/MermaidImage";
import DynamicChartRenderer from "../documents/[documentId]/nodes/ChartNode/DynamicChartRenderer";
import KatexRenderer from "~/components/ui/katex-renderer";
import CodeHighlightPlugin from "../documents/[documentId]/plugins/code-highlight-plugin";
import { theme } from "../documents/[documentId]/themes/theme";
import { captureHeld } from "~/lib/capture-hold";
import {
  embedRenderRequest,
  type EmbedRequest,
} from "~/lib/embed-render-contract";
import { z } from "zod";
import { documentFont } from "~/lib/document-fonts";
import { FontResources } from "../documents/[documentId]/document-typography";
import "~/styles/document.css";
import { CHART_FRAME_CLASS, chartFrame } from "~/lib/chart-frame";

const chartData = z.array(z.record(z.string(), z.unknown()));
const chartConfig = z.record(
  z.string(),
  z.union([
    z.object({ label: z.string().optional(), color: z.string().optional() }),
    z.object({
      label: z.string().optional(),
      theme: z.object({ light: z.string(), dark: z.string() }),
    }),
  ]),
);

declare global {
  interface Window {
    renderNativeEmbed?: (input: unknown) => void;
    nativeEmbedReady?: () => boolean;
  }
}

export default function NativeRenderer() {
  const { setTheme } = useTheme();
  const [request, setRequest] = useState<EmbedRequest>();
  // External system: the authenticated render worker calls this browser bridge.
  useEffect(() => {
    window.renderNativeEmbed = (input) => {
      const next = embedRenderRequest.parse(input);
      setTheme(next.theme);
      setRequest(next);
    };
    window.nativeEmbedReady = () =>
      !captureHeld() &&
      !!document.getElementById("native-embed") &&
      !Array.from(document.querySelectorAll('[aria-busy="true"]')).some((element) => !element.closest("[data-native-article]"));
    return () => {
      delete window.renderNativeEmbed;
      delete window.nativeEmbedReady;
    };
  }, [setTheme]);
  if (!request) return null;
  const node = request.node;
  return (
    <article
      id="native-embed"
      className="document-content text-foreground"
      style={{
        width:
          node.type === "equation" && node.inline
            ? "max-content"
            : request.width,
        maxWidth: request.width,
        minHeight: 0,
        padding: 0,
        margin: 0,
        backgroundColor: "var(--background)",
        fontFamily: documentFont(request.fontFamily).family,
        fontSize: request.fontSize,
      }}
    >
      <FontResources fonts={[request.fontFamily]} />
      <Suspense fallback={<div aria-busy="true">Rendering…</div>}>
        {node.type === "mermaid" ? (
          <MermaidImage
            schema={node.schema}
            width={node.width ?? "inherit"}
            height={node.height ?? "inherit"}
            natural={undefined}
          />
        ) : node.type === "equation" ? (
          node.inline ? (
            <span className="editor-equation">
              <KatexRenderer
                equation={node.equation}
                inline
                onDoubleClick={() => {}}
              />
            </span>
          ) : (
            <div className="editor-equation">
              <KatexRenderer
                equation={node.equation}
                inline={false}
                onDoubleClick={() => {}}
              />
            </div>
          )
        ) : node.type === "chart" ? (
          <div
            className={CHART_FRAME_CLASS}
            style={{
              position: "relative",
              ...chartFrame(
                node.width ?? "inherit",
                node.height ?? "inherit",
                chartData.parse(JSON.parse(node.chartData)).length === 0,
              ),
            }}
          >
            <DynamicChartRenderer
              chartType={node.chartType}
              data={chartData.parse(JSON.parse(node.chartData))}
              config={chartConfig.parse(JSON.parse(node.chartConfig))}
              width={node.width ?? "inherit"}
              height={node.height ?? "inherit"}
            />
          </div>
        ) : node.type === "article" ? (
          <div data-native-article style={{ textAlign: node.format || undefined }}>
            <ArticleContent html={(node.data.mode === "url" ? node.data.distilled : node.data.snapshot)?.contentHtml ?? ""} />
          </div>
        ) : (
          <LexicalComposer
            initialConfig={{
              namespace: "native-code-render",
              editable: false,
              nodes: [DocumentCodeNode, CodeHighlightNode],
              theme,
              onError: (error) => {
                throw error;
              },
              editorState: JSON.stringify({
                root: {
                  type: "root",
                  version: 1,
                  children: [node],
                  direction: null,
                  format: "",
                  indent: 0,
                },
              }),
            }}
          >
            <RichTextPlugin
              contentEditable={<ContentEditable />}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <CodeHighlightPlugin />
          </LexicalComposer>
        )}
      </Suspense>
      {(node.type === "mermaid" || node.type === "chart") &&
      node.$?.figure?.caption?.trim() ? (
        <div className="document-caption">{node.$.figure.caption}</div>
      ) : null}
    </article>
  );
}
