import {
  CreateMLCEngine,
  InitProgressCallback,
  MLCEngine,
  AppConfig,
} from "@mlc-ai/web-llm";

let engine: MLCEngine | null = null;

type Config = {
  model: AppConfig["model_list"][number]["model_id"];
  temperature: number;
  maxTokens: number;
};

let config: Config = {
  model: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
  temperature: 0.3,
  maxTokens: 20,
};

const initProgressCallback: InitProgressCallback = (initProgress) => {
  postMessage({ type: "progress", ...initProgress });
};

/** Trim overlapping prefix from the completion so we don't repeat user input. */
function trimOverlap(prompt: string, completion: string): string {
  for (let i = 0; i < prompt.length; i++) {
    if (completion.startsWith(prompt.slice(i))) {
      return completion.slice(prompt.length - i);
    }
  }
  return completion;
}

/**
 * Actually calls engine.completion, and trims overlapping prefix.
 */
async function completeTextSnippet(textSnippet: string) {
  if (!engine) throw new Error("Engine not ready");

  const result = await engine.completion({
    prompt: textSnippet,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
  });

  const completion = result.choices?.[0]?.text?.trim() || "";
  return trimOverlap(textSnippet, completion);
}

self.onmessage = async (evt: MessageEvent) => {
  const { type } = evt.data;

  if (type === "init") {
    try {
      if (evt.data.options) {
        config = { ...config, ...(evt.data.options as Config) };
      }
      postMessage({ type: "loading" });
      engine = await CreateMLCEngine(config.model, { initProgressCallback });
      postMessage({ type: "ready" });
    } catch (e) {
      postMessage({ type: "error", error: String(e) });
    }
    return;
  }

  if (!engine) {
    postMessage({ type: "error", error: "Model not ready" });
    return;
  }

  if (type === "settings") {
    config.temperature = evt.data.temperature;
    config.maxTokens = evt.data.maxTokens;
    if (config.model !== evt.data.model) {
      config.model = evt.data.model;
      engine = await CreateMLCEngine(config.model, { initProgressCallback });
    }
    return;
  }

  if (type === "completion") {
    const textSnippet = evt.data.textSnippet;
    const requestId = evt.data.requestId;

    console.log(
      "Text snippet: ",
      textSnippet,
      "\nModel: ",
      config.model,
      "\nTemperature: ",
      config.temperature,
      "\nMax tokens: ",
      config.maxTokens,
      "\nRequest ID: ",
      requestId,
    );

    try {
      const answer = await completeTextSnippet(textSnippet);

      // If still valid, send the result
      if (answer) {
        const response = {
          type: "completion",
          requestId,
          textSnippet,
          completion: answer,
        };
        console.log("response", response);
        postMessage(response);
      }
    } catch (err) {
      postMessage({ type: "error", error: String(err) });
    }
  }
};
