"use client";

import React, { useState } from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Pencil1Icon,
  Cross1Icon,
  CheckIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { useToast } from "~/components/ui/use-toast";

type Props = {
  title: string;
  drawingId: string;
  onTitleChange: () => Promise<void>;
};

const EntityTitle = ({ title, drawingId, onTitleChange }: Props) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const { toast } = useToast();
  const { mutate } = api.entities.update.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = () => {
    setIsLoading(true);
    mutate(
      { id: drawingId, title: newTitle },
      {
        onSuccess: async () => {
          await onTitleChange();
          toast({ title: "Saved!", description: title });
          setIsEditing(false);
          setIsLoading(false);
        },
        onError: (error) => {
          toast({ title: error.message, variant: "destructive" });
          setIsEditing(false);
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <div className="flex w-full gap-4">
      <div className="flex flex-1  items-center gap-2">
        {!isEditing && (
          <>
            <span className="flex-1 text-lg font-semibold">{title}</span>
            <Button
              className="px-2"
              variant="outline"
              onClick={() => setIsEditing(true)}
              aria-label="Edit title"
            >
              <Pencil1Icon className="w-4" />
            </Button>
          </>
        )}
        {(isEditing || isLoading) && (
          <>
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className=" text-lg font-semibold px-0 border-none focus-visible:ring-transparent"
            ></Input>
            <Button
              className="px-2"
              variant="outline"
              disabled={isLoading}
              onClick={handleSave}
              type="submit"
            >
              {!isLoading && <CheckIcon className="w-4" />}
              {isLoading && <ReloadIcon className="animate-spin w-4" />}
            </Button>
            <Button
              className="px-2"
              variant="outline"
              disabled={isLoading}
              onClick={() => setIsEditing(false)}
            >
              <Cross1Icon className="w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default EntityTitle;
