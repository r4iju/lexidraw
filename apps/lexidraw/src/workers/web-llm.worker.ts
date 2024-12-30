import {
  CreateMLCEngine,
  InitProgressCallback,
  MLCEngine,
  AppConfig,
} from "@mlc-ai/web-llm";
import { debounce } from "@packages/lib";

let engine: MLCEngine | null = null;

type Config = {
  model: AppConfig["model_list"][number]["model_id"];
  temperature: number;
  maxTokens: number;
};

const config: Config = {
  model: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
  temperature: 0.3,
  maxTokens: 24,
};

const initProgressCallback: InitProgressCallback = (initProgress) => {
  postMessage({ type: "progress", ...initProgress });
};

(async () => {
  console.log("initializing web-llm");
  postMessage({ type: "loading" });
  engine = await CreateMLCEngine(config.model, { initProgressCallback });

  postMessage({ type: "ready" });
  console.log("web-llm is ready");
})();

self.onmessage = debounce(async (evt: MessageEvent) => {
  if (!engine) {
    postMessage({ type: "error", error: "Model not ready" });
    return;
  }

  if (evt.data.type === "settings") {
    config.temperature = evt.data.temperature;
    config.maxTokens = evt.data.maxTokens;
    if (config.model !== evt.data.model) {
      config.model = evt.data.model;
      engine = await CreateMLCEngine(config.model, { initProgressCallback });
    }
    return;
  }

  if (evt.data.type === "completion") {
    try {
      const textSnippet = evt.data.textSnippet;

      console.log(
        "complete textSnippet: ",
        textSnippet,
        "with model: ",
        config.model,
        "with temperature: ",
        config.temperature,
        "with maxTokens: ",
        config.maxTokens,
      );

      const result = await engine.chatCompletion({
        messages: [
          {
            role: "system",
            content: `
          You are an autocomplete assistant. Your job is to complete the user's sentence with minimal, concise, and relevant text. 

          - Do not repeat the user's input.
          - Do not include greetings or explanations.
          - Do not introduce new ideas unrelated to the context.
          - Do not repeat the examples below.
          - Respond in the same tone and style as the user input. 

          Examples:
          User: "The quick brown fox"
          Assistant: " jumps over the lazy dog"

          User: "She went to the store to buy"
          Assistant: " some groceries."

          User: "Artificial intelligence is"
          Assistant: " transforming the world."`.replaceAll("          ", ""),
          },
          {
            role: "user",
            content: `${textSnippet}`,
          },
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        top_p: 0.95,
      });

      const answer = result.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        console.log("no answer", result);
        return;
      }

      postMessage({ type: "completion", text: answer });
    } catch (err) {
      postMessage({ type: "error", error: String(err) });
    }
  }
}, 300);
