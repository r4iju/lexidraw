import YTDlpWrapImport, { type Progress } from "yt-dlp-wrap";

const YTDlpWrap =
  // @ts-expect-error this is fine
  YTDlpWrapImport.default || YTDlpWrapImport;

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Initialize YTDlpWrap
// You might need to specify the path to yt-dlp binary if not in PATH
// const ytDlpPath = path.join(__dirname, '../../bin'); // Corrected path separator
// const ytdlp = new YTDlpWrap(path.join(ytDlpPath, 'yt-dlp'));
const ytdlp = new YTDlpWrap(); // Assumes yt-dlp is in PATH or installed via YTDlpWrap

// Ensure temp directory exists
const tempDir = path.join(os.tmpdir(), "media-downloader");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const COMMON_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/605.1.15",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/124.0.0.0",
];

interface YTDLPMetadata {
  title?: string;
  duration?: number;
  // You can add other known properties here e.g., uploader?: string;
  [key: string]: unknown; // Use unknown for other dynamic properties
}

export interface DownloadResult {
  filePath: string;
  title: string;
  duration?: number;
  error?: string;
}

export class DownloadService {
  async downloadVideo({
    url,
    cookies,
  }: {
    url: string;
    cookies?: string;
  }): Promise<DownloadResult> {
    console.log(`Starting download for URL: ${url}`);
    const stderrOutput: string[] = []; // Used for collecting all stderr
    const stdoutOutput: string[] = []; // Used for collecting all stdout
    let metadata: YTDLPMetadata = {};
    let downloadedFilePath: string | undefined;

    try {
      try {
        console.log(`Attempting to fetch metadata for URL: ${url}`);
        // Select a random user agent for fetching metadata as well
        const metadataUserAgent =
          COMMON_USER_AGENTS[
            Math.floor(Math.random() * COMMON_USER_AGENTS.length)
          ];
        console.log(`Using User-Agent for metadata: ${metadataUserAgent}`);
        // build metadata args
        const metadataArgs: string[] = [];
        if (cookies) {
          console.log(`Using cookies for metadata: ${cookies}`);
          metadataArgs.push("--cookies", cookies);
        }
        metadataArgs.push("--user-agent", metadataUserAgent);
        metadata = await ytdlp.getVideoInfo(url, metadataArgs);
        console.log("Successfully fetched metadata.");
      } catch (metadataError: unknown) {
        const message =
          metadataError instanceof Error
            ? metadataError.message
            : String(metadataError);
        console.warn(`Could not fetch metadata for ${url}:`, message);
      }

      console.log(`Proceeding to download. Output directory: ${tempDir}`);

      // Construct filename: use title from metadata if available, otherwise a generic name
      // Sanitize title to be filesystem-friendly
      const sanitizedTitle = metadata.title
        ?.replace(/[^a-zA-Z0-9_.-]/g, "_") // Replace invalid chars
        .substring(0, 100); // Limit length
      const baseFileName = sanitizedTitle || `downloaded_video_${Date.now()}`;
      // yt-dlp will append the correct extension based on format chosen or default
      const outputTemplate = path.join(tempDir, `${baseFileName}.%(ext)s`);

      const selectedUserAgent =
        COMMON_USER_AGENTS[
          Math.floor(Math.random() * COMMON_USER_AGENTS.length)
        ];
      console.log(`Selected User-Agent for download: ${selectedUserAgent}`);

      // build download args
      const downloadArgs: string[] = [url];
      if (cookies) {
        console.log(`Using cookies for download: ${cookies}`);
        downloadArgs.push("--cookies", cookies);
      }
      downloadArgs.push(
        "--user-agent",
        selectedUserAgent,
        "-P",
        tempDir,
        "-o",
        outputTemplate,
        "--no-playlist",
        "--merge-output-format",
        "mp4",
      );
      const ytDlpProcess = ytdlp.exec(downloadArgs);

      const logPrefix = `[DownloadService:${path.basename(tempDir)}]`;

      console.log(
        `${logPrefix} yt-dlp command executed with args: `,
        ytDlpProcess.ytDlpProcess?.spawnargs,
      );

      ytDlpProcess.on("progress", (progress: Progress) => {
        console.log(
          `Download Progress: ${progress.percent}% at ${progress.currentSpeed} ETA ${progress.eta}`,
        );
      });

      ytDlpProcess.on("ytDlpEvent", (eventType: string, eventData: string) => {
        if (eventType === "stdout") {
          // stdout data is already a string as per yt-dlp-wrap types
          // console.log(`${logPrefix} YT-DLP STDOUT (via ytDlpEvent): ${eventData}`); // Can be very verbose
          stdoutOutput.push(eventData);
        } else if (eventType === "stderr") {
          // stderr data is already a string
          console.error(
            `${logPrefix} YT-DLP STDERR (via ytDlpEvent): ${eventData}`,
          ); // Log each stderr line
          stderrOutput.push(eventData);
        } else {
          console.log(
            `${logPrefix} ytDlpEvent (generic): ${eventType}`,
            eventData,
          );
        }
      });

      // Wait for the yt-dlp process to complete by listening to its events
      await new Promise<void>((resolve, reject) => {
        let capturedError: Error | null = null;

        // Listen for the 'close' event to determine success or failure based on exit code
        ytDlpProcess.on("close", async (code: number | null) => {
          console.log(`${logPrefix} yt-dlp process closed with code: ${code}`);
          // Log the full stderr output collected during the process
          if (stderrOutput.length > 0) {
            console.error(
              `${logPrefix} Full yt-dlp stderr output:\\n${stderrOutput.join("")}`,
            );
          }

          if (
            code !== 0 &&
            !stderrOutput.join("").includes("already been downloaded")
          ) {
            const errMsg =
              stderrOutput.length > 0
                ? stderrOutput.join("\n")
                : `yt-dlp process exited with code ${code}`;
            reject(capturedError || new Error(errMsg));
          } else {
            resolve();
          }
        });

        // Listen for 'error' events from the process itself (e.g., spawn errors)
        ytDlpProcess.on("error", (err: unknown) => {
          console.error("YTDlpWrap process error event:", err);
          capturedError = err instanceof Error ? err : new Error(String(err)); // Store it, 'close' event will handle rejection with this error
        });

        // Optional: Fallback timeout (if process hangs indefinitely)
        const timeoutMillis = 15 * 60 * 1000; // 15 minutes
        const fallbackTimeout = setTimeout(() => {
          const err = new Error(
            `yt-dlp process timed out after ${timeoutMillis / 60000} minutes`,
          );
          console.error(err.message);
          if (!capturedError) capturedError = err;
          reject(capturedError);
        }, timeoutMillis);

        // Clear timeout if process closes or errors before timeout
        ytDlpProcess.once("close", () => clearTimeout(fallbackTimeout));
        ytDlpProcess.once("error", () => clearTimeout(fallbackTimeout));
      });

      // Path Detection Logic (relies on scanning tempDir)
      let determinedFilePath: string | undefined;
      console.log(`Scanning tempDir for file starting with: ${baseFileName}`);
      try {
        const filesInTempDir = fs.readdirSync(tempDir);
        const potentialFiles = filesInTempDir.filter((f) =>
          f.startsWith(baseFileName),
        );

        if (potentialFiles.length === 1) {
          determinedFilePath = path.join(tempDir, potentialFiles[0]);
          console.log(
            `Found unique matching file in tempDir: ${determinedFilePath}`,
          );
        } else if (potentialFiles.length > 1) {
          console.warn(
            `Multiple files found starting with ${baseFileName}: ${potentialFiles.join(", ")}. Selecting newest.`,
          );
          potentialFiles.sort((a, b) => {
            try {
              const statA = fs.statSync(path.join(tempDir, a));
              const statB = fs.statSync(path.join(tempDir, b));
              return statB.ctime.getTime() - statA.ctime.getTime();
            } catch (statError) {
              console.error(`Error stating files for sorting: ${statError}`);
              return 0;
            }
          });
          if (potentialFiles.length > 0) {
            determinedFilePath = path.join(tempDir, potentialFiles[0]);
            console.log(`Selected newest matching file: ${determinedFilePath}`);
          }
        } else {
          console.warn(
            `No file found in tempDir starting with ${baseFileName}.`,
          );
          determinedFilePath = undefined;
        }
      } catch (readdirError) {
        console.error(`Error reading tempDir ${tempDir}:`, readdirError);
        determinedFilePath = undefined;
      }

      downloadedFilePath = determinedFilePath;

      // Use the correctly populated stdoutOutput and stderrOutput arrays
      const fullStdout = stdoutOutput.join("\n");
      const fullStderr = stderrOutput.join("\n");

      if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
        console.error(
          `Downloaded file path not determined or file does not exist. BaseFileName was: ${baseFileName}.`,
          "Stdout (last lines):",
          fullStdout.slice(-500),
          "Stderr:",
          fullStderr, // Log full stderr here
        );
        return {
          filePath: "",
          title: (metadata.title as string) || "Untitled (download error)",
          error: `Downloaded file not found or invalid. Stderr: ${fullStderr}`,
        };
      }

      // At this point, the file exists. If it's unplayable, it might be due to
      // yt-dlp internal issues not reflected in exit code. stderr might have clues.
      if (fullStderr.length > 0) {
        console.warn(
          `Download for ${baseFileName} completed, but stderr had content (check for warnings/errors):\n${fullStderr}`,
        );
      }

      console.log(
        `Download appears successful. File determined as: ${downloadedFilePath}`,
      );

      return {
        filePath: downloadedFilePath,
        title: (metadata.title as string) || "Untitled (metadata unavailable)", // Ensure title is string
        duration: metadata.duration as number | undefined, // Ensure duration is number or undefined
      };
    } catch (error: unknown) {
      console.error(
        "Error during video download process or in yt-dlp execution:",
        error, // This is the error from the new Promise (or earlier)
        "Cumulative Stderr (from ytDlpEvent):",
        stderrOutput.join("\n"),
      );
      let errorMessage = "Unknown download error";
      if (error instanceof Error) {
        errorMessage = error.message;
        // No longer attempting (error as any).stderr as it's unreliable
      } else if (typeof error === "string") {
        errorMessage = error;
      }

      if (
        stderrOutput.length > 0 &&
        !errorMessage.includes(stderrOutput.join("\n"))
      ) {
        errorMessage += `\nStderr Output: ${stderrOutput.join("\n")}`;
      }

      return {
        filePath: "",
        title: (metadata.title as string) || "Untitled (download error)", // Ensure title is string
        error: errorMessage,
      };
    }
  }
}
