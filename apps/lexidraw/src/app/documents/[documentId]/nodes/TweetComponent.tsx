import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import type { ElementFormatType, NodeKey } from "lexical";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PrintedLink } from "./common/PrintedLink";

const WIDGET_SCRIPT_URL = "https://platform.twitter.com/widgets.js";

type TweetComponentProps = Readonly<{
  className: Readonly<{
    base: string;
    focus: string;
  }>;
  format: ElementFormatType | null;
  loadingComponent?: React.JSX.Element | string;
  nodeKey: NodeKey;
  onError?: (error: string) => void;
  onLoad?: () => void;
  tweetID: string;
}>;

export default function TweetComponent({
  className,
  format,
  loadingComponent,
  nodeKey,
  onError,
  onLoad,
  tweetID,
}: TweetComponentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const previousTweetIDRef = useRef<string>("");
  const [isTweetLoading, setIsTweetLoading] = useState(false);
  const [isTwitterScriptLoading, setIsTwitterScriptLoading] = useState(true);

  const createTweet = useCallback(async () => {
    try {
      // @ts-expect-error Twitter is attached to the window.
      await window.twttr.widgets.createTweet(tweetID, containerRef.current);

      setIsTweetLoading(false);
      setIsTwitterScriptLoading(false);

      if (onLoad) {
        onLoad();
      }
    } catch (error) {
      if (onError) {
        onError(String(error));
      }
    }
  }, [onError, onLoad, tweetID]);

  useEffect(() => {
    if (tweetID !== previousTweetIDRef.current) {
      setIsTweetLoading(true);

      if (isTwitterScriptLoading) {
        const script = document.createElement("script");
        script.src = WIDGET_SCRIPT_URL;
        script.async = true;
        document.body?.appendChild(script);
        script.onload = createTweet;
        if (onError) {
          script.onerror = onError as OnErrorEventHandler;
        }
      } else {
        createTweet();
      }

      if (previousTweetIDRef) {
        previousTweetIDRef.current = tweetID;
      }
    }
  }, [createTweet, isTwitterScriptLoading, onError, tweetID]);

  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      <div className="print:hidden">
        {isTweetLoading ? loadingComponent : null}
        <div
          style={{ display: "inline-block", width: "550px" }}
          ref={containerRef}
        />
      </div>
      <PrintedLink href={`https://x.com/i/status/${tweetID}`} />
    </BlockWithAlignableContents>
  );
}
