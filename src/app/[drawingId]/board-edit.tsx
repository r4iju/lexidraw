"use client";

import deepEqual from "fast-deep-equal/es6/react";
import {
  Excalidraw,
  exportToSvg,
  LiveCollaborationTrigger,
  THEME,
  restore,
} from "@excalidraw/excalidraw";
import {
  type ExcalidrawElement,
  type NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";
import {
  type UIAppState,
  type ExcalidrawImperativeAPI,
  type ExcalidrawProps,
  BinaryFiles,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";
import { RouterOutputs, type RouterInputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { CommitIcon, ReloadIcon } from "@radix-ui/react-icons";
import { PublicAccess } from "@prisma/client";
import { useUserIdOrGuestId } from "~/hooks/useUserIdOrGuestId";

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
  const isRemoteUpdate = useRef(false);
  // excalidraw api
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null);
  // server state
  const { mutate: save, isLoading: isSaving } = api.drawings.save.useMutation();
  const { mutate: updateDrawing } = api.drawings.update.useMutation();
  const { mutate: createElement } = api.elements.create.useMutation();
  const { mutate: upsertElement } = api.elements.upsert.useMutation();
  const { mutate: deleteElement } = api.elements.delete.useMutation();
  const { mutate: saveAppState } = api.appState.upsert.useMutation();
  const { mutate: setElementsOrder } =
    api.drawings.setElementsOrder.useMutation();
  // local state
  const [isCollaborating, setIsCollaborating] = useState(false);
  const prevElementsRef = useRef<Map<string, ExcalidrawElement>>(
    new Map(elements?.map((e) => [e.id, e])),
  );
  // thumbnails
  const { mutate: saveSvg } = api.snapshot.create.useMutation();
  // web-RTC
  const [shouldFetchOffer, setShouldFetchOffer] = useState(true);
  const [shouldFetchAnswer, setShouldFetchAnswer] = useState(false);
  const [localConnection, setLocalConnection] =
    useState<RTCPeerConnection | null>(null);
  // const [remoteConnection, setRemoteConnection] =
  //   useState<RTCPeerConnection | null>(null);
  const [channel, setChannel] = useState<RTCDataChannel | null>(null);
  const { mutate: upsertOfferMutate } = api.webRtc.upsertOffer.useMutation();
  const { mutate: upsertAnswerMutate } = api.webRtc.upsertAnswer.useMutation();
  const { data: offers } = api.webRtc.getOffers.useQuery(
    { drawingId, userId: userId ?? "" },
    {
      refetchInterval: 5000,
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
  const { data: answers } = api.webRtc.getAnswers.useQuery(
    { drawingId, userId: userId ?? "" },
    {
      refetchInterval: 5000,
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

  // Initialize local peer connection
  useEffect(() => {
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
    channel.onmessage = (e) => handleMessage(e.data as string);
    channel.onopen = () => console.log("Channel opened!");
    channel.onclose = () => console.log("Channel closed!");

    setLocalConnection(localConn);
    setChannel(channel);

    // Cleanup
    return () => {
      channel.close();
      localConn.close();
    };
  }, []);

  // Listen for remote data channel
  useEffect(() => {
    if (!localConnection) return;

    localConnection.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onmessage = (e) => handleMessage(e.data as string);
      channel.onopen = () => console.log("Channel opened!");
      channel.onclose = () => console.log("Channel closed!");
      setChannel(channel);
    };
  }, [localConnection]);

  const handleMessage = (data: string) => {
    const message = JSON.parse(data) as MessageStructure;
    switch (message.type) {
      case "update":
        applyUpdate(message.payload);
        break;
    }
  };

  type SendUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSendUpdate = useCallback(
    debounce(({ elements, appState }: SendUpdateProps) => {
      if (isRemoteUpdate.current) {
        // If it is, do not send the update back to avoid feedback loop
        return;
      }

      if (deepEqual(elements, prevElementsRef.current)) {
        return;
      } else {
        updateElementsRef(elements);
      }
      const message = JSON.stringify({
        payload: {
          elements,
          appState,
        },
        type: "update",
      } satisfies MessageStructure);
      if (channel?.readyState === "open") {
        channel.send(message);
      } else {
        console.log("Channel not available");
      }
    }, 200),
    [channel],
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

  const updateElementsRef = useCallback(
    (currentElements: readonly ExcalidrawElement[]) => {
      const newMap = new Map();
      currentElements.forEach((element) => {
        newMap.set(element.id, element);
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      prevElementsRef.current = newMap;
    },
    [],
  );

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleElementsChange = useCallback(
    debounce((elements: readonly ExcalidrawElement[]) => {
      const prevElementsMap = prevElementsRef.current;
      const added: ExcalidrawElement[] = [];
      const updated: ExcalidrawElement[] = [];
      const deleted: string[] = [];

      elements.forEach((element) => {
        const prevElement = prevElementsMap.get(element.id);
        if (!prevElement) {
          added.push(element);
        } else if (!deepEqual(element, prevElement)) {
          updated.push(element);
        }
      });

      prevElementsMap.forEach((_, id) => {
        if (!elements.find((el) => el.id === id)) {
          deleted.push(id);
        }
      });

      added.map((element) => {
        createElement({
          drawingId: drawingId,
          element: convertElementToAPIFormat(element),
        });
      });

      updated.map((element) => {
        upsertElement({
          drawingId: drawingId,
          element: convertElementToAPIFormat(element),
        });
      });

      deleted.map((id) => {
        deleteElement({
          id: id,
        });
      });

      if (added.length || updated.length || deleted.length) {
        setElementsOrder({
          drawingId: drawingId,
          elementsOrder: elements.map((el) => el.id),
        });
      }

      updateElementsRef(elements); // Update the reference after processing changes
    }, 500),
    [],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAppStateChange = useCallback(
    debounce((newAppState: UIAppState) => {
      saveAppState({
        drawingId: drawingId,
        appState: JSON.stringify(newAppState),
      });
    }, 10000),
    [],
  );

  const handleToggleLiveCollaboration = async () => {
    const wasCollaborating = isCollaborating.valueOf();
    const newAccessLevel = wasCollaborating
      ? PublicAccess.EDIT
      : PublicAccess.READ;
    updateDrawing(
      { id: drawingId, publicAccess: newAccessLevel },
      {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSuccess: async () => {
          await navigator.clipboard.writeText(
            wasCollaborating ? "" : window.location.origin + "/" + drawingId,
          );
          toast(
            wasCollaborating
              ? {
                  title: "Live collaboration disabled!",
                  variant: "destructive",
                }
              : {
                  title: "Live collaboration enabled!",
                  description: "Link copied to clipboard",
                  variant: "default",
                },
          );
          setIsCollaborating(!wasCollaborating);
        },
        onError: (error) => {
          toast({
            title: "Something went wrong!",
            description: error.message,
            variant: "destructive",
          });
          return;
        },
      },
    );
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

  const onChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      state: UIAppState,
      _: BinaryFiles,
    ) => {
      const nonDeletedElements = elements.filter(
        (el) => !el.isDeleted,
      ) as NonDeletedExcalidrawElement[];
      debouncedSendUpdate({ elements: nonDeletedElements, appState: state });
    },
    [debouncedSendUpdate],
  );

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

  type ApplyUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  const applyUpdate = ({ elements, appState }: ApplyUpdateProps) => {
    isRemoteUpdate.current = true;
    excalidrawApi.current?.updateScene({
      elements,
      // appState: {
      //   ...appState,
      //   collaborators: new Map(Object.entries(appState.collaborators)),
      // },
    });
    setTimeout(() => (isRemoteUpdate.current = false), 0);
  };

  // switching dark-light mode
  useEffect(() => {
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? THEME.DARK : THEME.LIGHT },
    });
  }, [isDarkTheme, excalidrawApi.current]);

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
          </>
        )}
      />
    </div>
  );
};
export default ExcalidrawWrapper;
