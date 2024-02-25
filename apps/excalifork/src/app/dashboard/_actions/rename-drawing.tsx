"use client";

import React, { useState } from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Pencil1Icon, Cross1Icon, CheckIcon } from "@radix-ui/react-icons";
import { useToast } from "~/components/ui/use-toast";

type Props = {
  title: string;
  drawingId: string;
  onTitleChange: VoidFunction;
};

const DrawingTitle = ({ title, drawingId, onTitleChange }: Props) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const { toast } = useToast();
  const { mutate } = api.drawings.update.useMutation();

  const handleSave = () => {
    mutate(
      { id: drawingId, title: newTitle },
      {
        onSuccess: () => {
          setIsEditing(false);
          onTitleChange();
          toast({ title: "Saved!" });
        },
      },
    );
  };

  return (
    <div className="flex w-full gap-4">
      <div className="flex flex-1  items-center gap-2">
        {!isEditing && (
          <span className="flex-1 text-lg font-bold">{title}</span>
        )}
        {isEditing && (
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="flex-1 text-lg"
          />
        )}
        {isEditing && (
          <>
            <Button variant="outline" onClick={handleSave}>
              <CheckIcon className="h-5 w-5" />
            </Button>
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              <Cross1Icon className="h-5 w-5" />
            </Button>
          </>
        )}
        {!isEditing && (
          <>
            <Button
              variant="outline"
              onClick={() => setIsEditing(true)}
              aria-label="Edit title"
            >
              <Pencil1Icon className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default DrawingTitle;
