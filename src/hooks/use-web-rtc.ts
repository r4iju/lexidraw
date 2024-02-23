"use client";

import { useCallback, useEffect, useState } from 'react';
import { type ICommunicationOptions, type ICommunicationProps, type ICommunicationReturnType, type MessageStructure } from './communication-service';
import { useToast } from '~/components/ui/use-toast';
import { api } from '~/trpc/react';

export function useWebRtcService(
  { drawingId, userId }: ICommunicationProps,
  { onMessage }: ICommunicationOptions): ICommunicationReturnType {
  const { toast } = useToast();
  const { data: iceServers } = api.auth.iceServers.useQuery();
  const [shouldFetchOffer, setShouldFetchOffer] = useState(false);
  const [shouldFetchAnswer, setShouldFetchAnswer] = useState(false);
  const [localConnection, setLocalConnection] = useState<RTCPeerConnection | null>(null);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);

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

  const handleChannelClosed = useCallback(() => {
    toast({
      title: "Channel closed!",
    });
    setLocalConnection(null);
    setDataChannel(null);
    setShouldFetchOffer(true);
  }, [toast]);

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

  const closeConnection = () => {
    setShouldFetchAnswer(false);
    setShouldFetchOffer(false);
    if (localConnection) {
      localConnection.close();
    }
    if (dataChannel) {
      dataChannel.close();
    }
  }

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

  const initializeConnection = useCallback(() => {
    if (!iceServers) {
      toast({
        title: "No ICE servers available",
        description: "Please login or try again later.",
        variant: "destructive",
      })
      return
    }
    const localConn = new RTCPeerConnection({ iceServers });

    // ICE candidate handler
    localConn.onicecandidate = (e) => {
      console.log("localConn.onicecandidate");
      if (e.candidate && localConn.localDescription?.type === "offer") {
        // console.log(JSON.stringify(localConn.localDescription));
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
    channel.onmessage = (event: MessageEvent<string>) => onMessage(JSON.parse(event.data) as MessageStructure);
    channel.onopen = handleChannelOpened;
    channel.onclose = handleChannelClosed;

    setLocalConnection(localConn);
    setDataChannel(channel);
    setShouldFetchOffer(true);
  }, [drawingId, handleChannelClosed, handleChannelOpened, iceServers, onMessage, toast, upsertOfferMutate, userId]);

  // Listen for remote data channel
  useEffect(() => {
    if (!localConnection) return;

    localConnection.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onmessage = (event: MessageEvent<string>) => onMessage(JSON.parse(event.data) as MessageStructure);
      channel.onopen = handleChannelOpened;
      channel.onclose = handleChannelClosed;
      setDataChannel(channel);
    };
  }, [handleChannelClosed, handleChannelOpened, localConnection, onMessage]);

  const sendMessage = useCallback((message: MessageStructure) => {
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(message));
    }
  }, [dataChannel]);

  return { closeConnection, sendMessage, initializeConnection };
}
