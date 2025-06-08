import React, { useState, useCallback, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { useSlideCreationWorkflow } from "../use-slide-creation-workflow";
import {
  PaperclipIcon,
  XIcon,
  FileIcon,
  SparklesIcon,
  StopCircleIcon,
} from "lucide-react";
import { Switch } from "~/components/ui/switch";
import env from "@packages/env";

interface FormData {
  attachCurrentDocument: boolean;
  topic: string;
  who: string;
  outcome: string;
  timebox: string;
}

export const SlideGenerationForm: React.FC = () => {
  const [formData, setFormData] = useState<FormData>(
    env.NEXT_PUBLIC_NODE_ENV === "development"
      ? {
          attachCurrentDocument: false,
          topic: "The future of sewing in a post-tarrif world",
          who: "Housewives",
          outcome: "Reducing trade deficits and getting self-sufficient",
          timebox: "1 hour",
        }
      : {
          attachCurrentDocument: false,
          topic: "",
          who: "",
          outcome: "",
          timebox: "",
        },
  );
  const [files, setFiles] = useState<File[] | null>(null);
  const { startSlideGeneration, isLoading, cancelSlideGeneration } =
    useSlideCreationWorkflow();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheckedChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, attachCurrentDocument: checked }));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      setFiles(Array.from(selectedFiles));
    }
  };

  const handleRemoveFile = (index: number) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((_, i) => i !== index);
    setFiles(newFiles.length > 0 ? newFiles : null);
    if (newFiles.length === 0 && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // Basic validation: ensure all fields (except files) are filled
      if (
        !formData.topic ||
        !formData.who ||
        !formData.outcome ||
        !formData.timebox
      ) {
        // TODO: Add user-facing validation feedback
        alert("Please fill in all fields to generate slides.");
        return;
      }
      if (isLoading) return;

      await startSlideGeneration({ ...formData, files: files || undefined });
      // reset form?
    },
    [formData, files, startSlideGeneration, isLoading],
  );

  return (
    <>
      <form onSubmit={handleSubmit} className="p-3 space-y-4 text-sm">
        <div className="space-x-2 flex items-center">
          <Label htmlFor="attachCurrentDocument">Attach Current Document</Label>
          <Switch
            id="attachCurrentDocument"
            onCheckedChange={handleCheckedChange}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="topic">Topic</Label>
          <Input
            id="topic"
            name="topic"
            value={formData.topic}
            onChange={handleChange}
            placeholder="e.g., The Future of AI"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="who">Audience (Who is it for?)</Label>
          <Input
            id="who"
            name="who"
            value={formData.who}
            onChange={handleChange}
            placeholder="e.g., Tech Investors, Marketing Team"
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outcome">Desired Outcome (Why?)</Label>
          <Textarea
            id="outcome"
            name="outcome"
            value={formData.outcome}
            onChange={handleChange}
            placeholder="e.g., Secure funding, Align on Q3 strategy"
            rows={3}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="timebox">Timebox (How long?)</Label>
          <Input
            id="timebox"
            name="timebox"
            value={formData.timebox}
            onChange={handleChange}
            placeholder="e.g., 20 minutes, 1 hour"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="file-upload-slidegen"
            className="text-xs text-muted-foreground"
          >
            Optional Research Materials (PDFs)
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="w-full justify-start text-muted-foreground"
          >
            <PaperclipIcon className="w-4 h-4 mr-2" />
            Attach Files
          </Button>
          <input
            type="file"
            accept=".pdf"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            id="file-upload-slidegen"
            multiple
            disabled={isLoading}
          />
          {files && files.length > 0 && (
            <div className="space-y-1 pt-1">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-muted text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileIcon className="size-4 flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemoveFile(index)}
                    className="hover:bg-background size-6 flex-shrink-0"
                    disabled={isLoading}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Button type="submit" className="w-full" disabled={isLoading}>
            <SparklesIcon className="w-4 h-4 mr-2" />
            {isLoading ? "Generating Slides..." : "Generate Slides"}
          </Button>
          {isLoading && (
            <Button
              type="button"
              variant="destructive"
              onClick={cancelSlideGeneration}
              size="icon"
              className="size-10"
            >
              <StopCircleIcon className="size-6" />
            </Button>
          )}
        </div>
      </form>
    </>
  );
};
