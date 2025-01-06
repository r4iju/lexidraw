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
import { RouterOutputs } from "~/trpc/shared";
import { useRouter } from "next/navigation";
import { cn } from "~/lib/utils";

type Props = {
  className?: string;
  entity: RouterOutputs["entities"]["list"][number];
  revalidatePath: () => Promise<void>;
};

const EntityTitle = ({ className, entity, revalidatePath }: Props) => {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(entity.title);
  const { toast } = useToast();
  const { mutate } = api.entities.update.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = () => {
    setIsLoading(true);
    mutate(
      { id: entity.id, title: newTitle },
      {
        onSuccess: async () => {
          await revalidatePath();
          router.refresh();
          toast({ title: "Saved!", description: newTitle });
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
    <div className={cn("flex w-full gap-4", className)}>
      <div className="flex flex-1  items-center gap-2">
        {!isEditing && (
          <>
            <span className="flex-1 text-lg font-semibold line-clamp-1">
              {newTitle}
            </span>
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
            >
              {!isLoading && <CheckIcon className="w-4" />}
              {isLoading && <ReloadIcon className="animate-spin w-4" />}
            </Button>
            <Button
              className="px-2"
              variant="outline"
              disabled={isLoading}
              onClick={() => {
                setIsEditing(false);
                setNewTitle(entity.title);
              }}
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
