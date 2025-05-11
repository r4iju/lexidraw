import YTDlpWrap from "yt-dlp-wrap";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

export interface DownloadResult {
  filePath: string;
  title: string;
  duration?: number;
  error?: string;
}

export class DownloadService {
  async downloadVideo(url: string): Promise<DownloadResult> {
    console.log(`Starting download for URL: ${url}`);
    const stderrOutput: string[] = [];
    const stdoutOutput: string[] = []; // To collect stdout messages
    let metadata: { title?: string; duration?: number; [key: string]: any } =
      {};
    let downloadedFilePath: string | undefined = undefined;

    try {
      try {
        console.log(`Attempting to fetch metadata for URL: ${url}`);
        metadata = await ytdlp.getVideoInfo(url);
        console.log("Successfully fetched metadata.");
      } catch (metadataError: unknown) {
        const message =
          metadataError instanceof Error
            ? metadataError.message
            : String(metadataError);
        console.warn(`Could not fetch metadata for ${url}:`, message);
      }

      console.log(`Proceeding to download. Output directory: ${tempDir}`);

      const downloadProcess = ytdlp.exec([
        url,
        "--no-playlist",
        "--max-filesize",
        "2G",
        "-P",
        tempDir,
      ]);

      downloadProcess.on("progress", (progress) => {
        console.log(
          `Download Progress: ${progress.percent}% at ${progress.currentSpeed} ETA ${progress.eta}`,
        );
      });

      downloadProcess.on("ytDlpEvent", (eventType, eventData) => {
        if (eventType === "stderr") {
          console.warn("[yt-dlp stderr]:", eventData);
          stderrOutput.push(eventData);
        } else if (eventType === "stdout") {
          // console.log('[yt-dlp stdout]:', eventData); // Can be verbose
          stdoutOutput.push(eventData);
        }
      });

      await downloadProcess; // Wait for the process to complete
      const fullStdout = stdoutOutput.join("\n");
      // console.log('yt-dlp process finished. Full stdout:', fullStdout);

      const destinationRegex =
        /\[(?:download|info|ExtractAudio)\]\s+(?:Destination|Filename):\s*(.*)/i;
      let foundPath: string | null = null;

      const lines = fullStdout.split("\n");
      for (const line of lines) {
        const match = destinationRegex.exec(line);
        if (match && match[1]) {
          foundPath = match[1].trim();
          break;
        }
      }

      // Fallback: if no explicit destination line, check if stdout itself is a path (sometimes happens)
      if (
        !foundPath &&
        fullStdout.trim().startsWith(tempDir) &&
        fs.existsSync(fullStdout.trim())
      ) {
        foundPath = fullStdout.trim();
      }

      if (!foundPath) {
        // As a last resort, try to find the newest file in tempDir if no path was found in stdout.
        // This is less reliable and should only be a fallback.
        console.warn(
          "Could not parse downloaded file path from yt-dlp stdout. Attempting to find newest file in tempDir.",
        );
        const filesInTempDir = fs
          .readdirSync(tempDir)
          .map((name) => ({
            name,
            ctime: fs.statSync(path.join(tempDir, name)).ctime,
          }))
          .sort((a, b) => b.ctime.getTime() - a.ctime.getTime());
        if (filesInTempDir.length > 0) {
          foundPath = path.join(tempDir, filesInTempDir[0].name);
          console.log("Found newest file as fallback:", foundPath);
        }
      }

      if (!foundPath || !fs.existsSync(foundPath)) {
        console.error(
          "Downloaded file path not found or file does not exist. Stdout:",
          fullStdout,
          "Stderr:",
          stderrOutput.join("\n"),
        );
        return {
          filePath: "",
          title: metadata.title || "Untitled (download only)",
          error: `Downloaded file path not found. Details: ${stderrOutput.join("\n")}`,
        };
      }

      downloadedFilePath = foundPath;
      console.log(
        `Download appears successful. File determined as: ${downloadedFilePath}`,
      );

      return {
        filePath: downloadedFilePath,
        title: metadata.title || "Untitled (metadata unavailable)",
        duration: metadata.duration,
      };
    } catch (error: unknown) {
      console.error(
        "Error during video download process:",
        error,
        "Stderr:",
        stderrOutput.join("\n"),
      );
      let errorMessage = "Unknown download error";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      if (stderrOutput.length > 0) {
        errorMessage += `\nstderr: ${stderrOutput.join("\n")}`;
      }
      return {
        filePath: "",
        title: metadata.title || "Untitled (download error)",
        error: errorMessage,
      };
    }
  }
}
