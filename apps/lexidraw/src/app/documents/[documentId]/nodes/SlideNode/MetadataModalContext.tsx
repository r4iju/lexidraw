"use client";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type {
  DeckStrategicMetadata,
  SlideStrategicMetadata,
} from "./SlideNode";

interface MetadataModalContextType {
  isModalOpen: boolean;
  initialData?: DeckStrategicMetadata | SlideStrategicMetadata;
  slideId: string | null; // if null, implies "deck" type, otherwise "slide"
  openModal: (
    data?: DeckStrategicMetadata | SlideStrategicMetadata,
    slideId?: string | null, // optional: if it's for a slide
  ) => void;
  closeModal: () => void;
}

const MetadataModalContext = createContext<
  MetadataModalContextType | undefined
>(undefined);

export const MetadataModalProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [initialData, setInitialData] = useState<
    DeckStrategicMetadata | SlideStrategicMetadata | undefined
  >(undefined);
  const [slideId, setCurrentSlideIdForSave] = useState<string | null>(null);

  const openModal = useCallback(
    (
      data?: DeckStrategicMetadata | SlideStrategicMetadata,
      slideId: string | null = null, // default to null if not provided
    ) => {
      setInitialData(data);
      setCurrentSlideIdForSave(slideId); // if slideId is null, it's deck metadata
      setIsModalOpen(true);
    },
    [],
  );

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setInitialData(undefined);
    setCurrentSlideIdForSave(null);
  }, []);

  return (
    <MetadataModalContext.Provider
      value={{
        isModalOpen,
        initialData,
        slideId,
        openModal,
        closeModal,
      }}
    >
      {children}
    </MetadataModalContext.Provider>
  );
};

export const useMetadataModal = (): MetadataModalContextType => {
  const context = useContext(MetadataModalContext);
  if (context === undefined) {
    throw new Error(
      "useMetadataModal must be used within a MetadataModalProvider",
    );
  }
  return context;
};
