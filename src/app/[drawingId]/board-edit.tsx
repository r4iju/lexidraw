"use client";

import {
  Excalidraw,
  exportToSvg,
  LiveCollaborationTrigger,
  THEME,
} from "@excalidraw/excalidraw";
import {
  type ExcalidrawElement,
  type NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";
import {
  type UIAppState,
  type ExcalidrawImperativeAPI,
  type ExcalidrawProps,
  type BinaryFiles,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";
import { type RouterInputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { CommitIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useUserIdOrGuestId } from "~/hooks/useUserIdOrGuestId";
import ModeToggle from "~/components/theme/dark-mode-toggle";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<F extends (...args: any[]) => void>(
  fn: F,
  delay: number,
): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<F>) {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}

type MessageStructure = {
  type: "update";
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};

type Props = {
  drawingId: string;
  appState?: UIAppState;
  elements?: NonDeletedExcalidrawElement[];
};

function convertElementToAPIFormat(
  element: NonDeletedExcalidrawElement,
): RouterInputs["elements"]["create"]["element"] {
  const { id, type, x, y, width, height, ...properties } = element;
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    properties: JSON.stringify(properties),
  };
}

const ExcalidrawWrapper: React.FC<Props> = ({
  drawingId,
  appState,
  elements,
}) => {
  // hooks
  const isDarkTheme = useIsDarkTheme();
  const userId = useUserIdOrGuestId();
  const { toast } = useToast();
  // excalidraw api
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null);
  // server state
  const { mutate: save, isLoading: isSaving } = api.drawings.save.useMutation();
  // const { mutate: updateDrawing } = api.drawings.update.useMutation();
  // const { mutate: createElement } = api.elements.create.useMutation();
  // const { mutate: upsertElement } = api.elements.upsert.useMutation();
  // const { mutate: deleteElement } = api.elements.delete.useMutation();
  // const { mutate: saveAppState } = api.appState.upsert.useMutation();
  // const { mutate: setElementsOrder } = api.drawings.setElementsOrder.useMutation();
  // local state
  const [isCollaborating, setIsCollaborating] = useState(false);
  const prevElementsRef = useRef<Map<string, ExcalidrawElement>>(
    new Map(elements?.map((e) => [e.id, e])),
  );
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  // thumbnails
  const { mutate: saveSvg } = api.snapshot.create.useMutation();
  // web-RTC
  const [shouldFetchOffer, setShouldFetchOffer] = useState(false);
  const [shouldFetchAnswer, setShouldFetchAnswer] = useState(false);
  const [localConnection, setLocalConnection] =
    useState<RTCPeerConnection | null>(null);
  const [channel, setChannel] = useState<RTCDataChannel | null>(null);
  const { mutate: upsertOfferMutate } = api.webRtc.upsertOffer.useMutation();
  const { mutate: upsertAnswerMutate } = api.webRtc.upsertAnswer.useMutation();
  api.webRtc.getOffers.useQuery(
    { drawingId, userId: userId ?? "" },
    {
      refetchInterval: 2000,
      enabled: shouldFetchOffer,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSuccess: async (offers) => {
        setShouldFetchOffer(false);
        if (offers.at(-1)) {
          console.log("found offer from signaling server");
          await handleRemoteOffer(offers.at(-1)!.offer);
        } else {
          console.log("no offer from signaling server");
          await createOffer();
          setShouldFetchAnswer(true);
        }
      },
    },
  );
  api.webRtc.getAnswers.useQuery(
    { drawingId, userId: userId ?? "" },
    {
      refetchInterval: 1500,
      enabled: shouldFetchAnswer,
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onSuccess: async (answers) => {
        if (answers.at(-1)) {
          console.log("found answer from signaling server");
          await handleRemoteAnswer(answers.at(-1)!.answer);
          setShouldFetchAnswer(false);
        } else if (localConnection) {
          upsertOfferMutate({
            offerId: `${drawingId}-${userId}`,
            drawingId,
            userId,
            offer: JSON.stringify(localConnection.localDescription),
          });
        }
      },
    },
  );

  const handleChannelOpened = useCallback(() => {
    toast({
      title: "Channel opened!",
    });
  }, [toast]);

  const handleChannelClosed = () => {
    console.log("Channel closed!");
    setLocalConnection(null);
    setChannel(null);
    setShouldFetchOffer(true);
  };

  type ApplyUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  const applyUpdate = useCallback(({ elements }: ApplyUpdateProps) => {
    excalidrawApi.current?.updateScene({
      elements,
      // appState: {
      //   ...appState,
      //   collaborators: new Map(Object.entries(appState.collaborators)),
      // },
    });
  }, []);

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const message = JSON.parse(e.data) as MessageStructure;
      switch (message.type) {
        case "update":
          applyUpdate(message.payload);
          break;
      }
    },
    [applyUpdate],
  );

  const initializeConnection = () => {
    const iceServers = [
      // {
      //   urls: "turn:my-turn-server.mycompany.com:19403",
      //   username: "optional-username",
      //   credentials: "auth-token",
      // },
      {
        urls: "stun:stun1.l.google.com:19302",
      },
    ];
    const localConn = new RTCPeerConnection({ iceServers });

    // ICE candidate handler
    localConn.onicecandidate = (e) => {
      console.log("NEW ice candidate!! on localConnection reprinting SDP");
      if (e.candidate && localConn.localDescription?.type === "offer") {
        console.log(JSON.stringify(localConn.localDescription));
        upsertOfferMutate({
          offerId: `${drawingId}-${userId}`,
          drawingId,
          userId,
          offer: JSON.stringify(localConn.localDescription),
        });
      }
    };

    // Creating data channel
    const channel = localConn.createDataChannel("channel");
    channel.onmessage = handleMessage;
    channel.onopen = handleChannelOpened;
    channel.onclose = handleChannelClosed;

    setLocalConnection(localConn);
    setChannel(channel);
  };

  // Listen for remote data channel
  useEffect(() => {
    if (!localConnection) return;

    localConnection.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onmessage = handleMessage;
      channel.onopen = handleChannelOpened;
      channel.onclose = handleChannelClosed;
      setChannel(channel);
    };
  }, [handleChannelOpened, handleMessage, localConnection]);

  const sendUpdate = useCallback(
    ({ elements }: { elements: ExcalidrawElement[] }) => {
      if (channel?.readyState === "open") {
        const message = JSON.stringify({
          type: "update",
          payload: {
            elements,
            appState: excalidrawApi.current?.getAppState(),
          },
        });
        channel.send(message);
      }
    },
    [channel],
  );

  type SendUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  const sendPositionUpdates = useCallback(
    debounce(() => {
      const currentElements = excalidrawApi.current?.getSceneElements() ?? [];
      let isPositionChanged = false;
      currentElements.forEach((element) => {
        const prevPosition = prevPositionsRef.current.get(element.id);
        if (
          !prevPosition ||
          prevPosition.x !== element.x ||
          prevPosition.y !== element.y
        ) {
          isPositionChanged = true;
          prevPositionsRef.current.set(element.id, {
            x: element.x,
            y: element.y,
          });
        }
      });

      if (isPositionChanged) {
        sendUpdate({ elements: Array.from(currentElements) });
      }
    }, 150),
    [sendUpdate],
  );

  const updateElementsRef = useCallback(
    (currentElements: Map<string, ExcalidrawElement>) => {
      prevElementsRef.current = currentElements;
    },
    [],
  );

  const sendUpdateIfNeeded = useCallback(
    ({ elements }: SendUpdateProps) => {
      let changesDetected = false;
      const elementsToUpdate: ExcalidrawElement[] = [];
      const newElementsMap = new Map<string, ExcalidrawElement>();

      elements.forEach((element) => {
        const prevElement = prevElementsRef.current.get(element.id);
        if (!prevElement || prevElement.version !== element.version) {
          // console.log(
          //   `Change detected for element ${element.id}: Version ${prevElement?.version} -> ${element.version}, Position ${prevElement?.x},${prevElement?.y} -> ${element.x},${element.y}`,
          // );
          changesDetected = true;
          elementsToUpdate.push(element);
        }
        newElementsMap.set(element.id, element);
      });

      if (changesDetected) {
        console.log("Sending updates for changed elements");
        sendUpdate({ elements: elements });
      } else {
        console.log("No changes detected in elements");
      }
      updateElementsRef(newElementsMap);
    },
    [sendUpdate, updateElementsRef],
  );

  // Function to create offer
  const createOffer = async () => {
    if (!localConnection) return;

    try {
      const offer = await localConnection.createOffer();
      await localConnection.setLocalDescription(offer);
      console.log("Offer created and set as local description");
    } catch (error) {
      console.error("Failed to create offer:", error);
    }
  };

  // Function to handle remote offer and create answer
  // This would typically be triggered by receiving an offer from the remote peer
  const handleRemoteOffer = async (offer: string) => {
    if (!localConnection) return;

    try {
      await localConnection.setRemoteDescription(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        new RTCSessionDescription(JSON.parse(offer)),
      );
      const answer = await localConnection.createAnswer();
      await localConnection.setLocalDescription(answer);
      console.log("Answer created and set as local description");
      upsertAnswerMutate({
        answerId: `${drawingId}-${userId}`,
        drawingId,
        userId,
        answer: JSON.stringify(answer),
      });
      setShouldFetchAnswer(false);
    } catch (error) {
      console.error("Failed to create answer:", error);
    }
  };

  const handleRemoteAnswer = async (offer: string) => {
    if (!localConnection) return;

    try {
      await localConnection.setRemoteDescription(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        new RTCSessionDescription(JSON.parse(offer)),
      );
    } catch (error) {
      console.error("Failed to handle answer:", error);
    }
  };

  const saveToBackend = async () => {
    if (!excalidrawApi.current) return;
    const elements = excalidrawApi.current.getSceneElements();
    const appState: UIAppState = excalidrawApi.current.getAppState();
    await exportDrawingAsSvg({ elements: elements, appState });
    save(
      {
        id: drawingId,
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
        } satisfies UIAppState),
        elements: elements.map(convertElementToAPIFormat),
      },
      {
        onSuccess: () => {
          toast({
            title: "Saved!",
          });
        },
        onError: (err) => {
          toast({
            title: "Something went wrong!",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleToggleLiveCollaboration = async () => {
    const wasCollaborating = isCollaborating.valueOf();
    setIsCollaborating(!wasCollaborating);
    if (wasCollaborating) {
      setShouldFetchOffer(false);
      setShouldFetchAnswer(false);
      if (localConnection) {
        localConnection.close();
      }
      if (channel) {
        channel.close();
      }
    }
    if (!wasCollaborating) {
      initializeConnection();
      setShouldFetchOffer(true);
    }
  };

  type ExportAsSvgProps = {
    elements: readonly ExcalidrawElement[];
    appState: UIAppState;
  };

  const exportDrawingAsSvg = async ({
    elements,
    appState,
  }: ExportAsSvgProps) => {
    await Promise.all(
      [THEME.DARK, THEME.LIGHT].map(async (theme) => {
        const svg = await exportToSvg({
          elements,
          appState: {
            ...appState,
            theme: theme,
            exportWithDarkMode: theme === THEME.DARK ? true : false,
          },
          files: null,
          exportPadding: 10,
          renderEmbeddables: true,
          exportingFrame: null,
        });

        // convert it to string
        const svgString = new XMLSerializer().serializeToString(svg);
        saveSvg({
          drawingId: drawingId,
          svg: svgString,
          theme: theme,
        });
      }),
    );
  };

  const onChange = (
    elements: readonly ExcalidrawElement[],
    state: UIAppState,
    _: BinaryFiles,
  ) => {
    const nonDeletedElements = elements.filter(
      (el) => !el.isDeleted,
    ) as NonDeletedExcalidrawElement[];
    sendUpdateIfNeeded({ elements: nonDeletedElements, appState: state });
    sendPositionUpdates();
  };

  const options = {
    // excalidrawAPI: (api) => setExcalidrawAPI(api),
    initialData: {
      appState: appState
        ? ({
            ...appState,
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT, // Ensure the theme matches the site's theme
            exportWithDarkMode: false,
            exportBackground: false,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            collaborators: new Map(Object.entries(appState.collaborators)),
          } satisfies UIAppState)
        : ({
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
            exportWithDarkMode: false,
            exportBackground: false,
          } satisfies Partial<UIAppState>),
      elements: elements ?? [],
    },
    UIOptions: {
      canvasActions: {
        // export: {
        //   onExportToBackend(exportedElements, appState) {
        //     void saveToBackend({
        //       exportedElements: [...exportedElements],
        //       appState,
        //     });
        //   },
        // },
        toggleTheme: false,
      },
    },
    onChange: onChange,
    // isCollaborating: true,
  } satisfies ExcalidrawProps;

  // switching dark-light mode
  useEffect(() => {
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? THEME.DARK : THEME.LIGHT },
    });
  }, [isDarkTheme]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw
        {...options}
        excalidrawAPI={(api) => {
          excalidrawApi.current = api;
          console.log("excalidraw api set");
        }}
        renderTopRightUI={() => (
          <>
            <LiveCollaborationTrigger
              isCollaborating={isCollaborating}
              onSelect={handleToggleLiveCollaboration}
            />
            <Button onClick={saveToBackend} disabled={isSaving}>
              {!isSaving && <CommitIcon className=" h-4 w-4 " />}
              {isSaving && <ReloadIcon className=" h-4 w-4 animate-spin" />}
            </Button>
            <ModeToggle />
          </>
        )}
      />
    </div>
  );
};
export default ExcalidrawWrapper;
