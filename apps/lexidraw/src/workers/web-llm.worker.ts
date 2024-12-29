import {
  CreateMLCEngine,
  InitProgressCallback,
  MLCEngine,
  AppConfig,
} from "@mlc-ai/web-llm";

let engine: MLCEngine | null = null;

// const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC";
const selectedModel: AppConfig["model_list"][number]["model_id"] =
  "SmolLM2-135M-Instruct-q0f32-MLC";

const initProgressCallback: InitProgressCallback = (initProgress) => {
  console.log(initProgress);
};

(async () => {
  console.log("initializing web-llm");
  postMessage({ type: "loading" });
  engine = await CreateMLCEngine(
    selectedModel,
    { initProgressCallback }, // engineConfig
  );

  postMessage({ type: "ready" });
  console.log("web-llm is ready");
})();

self.onmessage = async (evt) => {
  if (!engine) {
    postMessage({ type: "error", error: "Model not ready" });
    return;
  }
  try {
    // basically openai completion
    console.log("evt.data", evt.data);
    const prompt = evt.data.prompt;

    console.log("extracted prompt", prompt);

    const result = await engine.chatCompletion({
      // minimal instruct-style usage
      messages: [
        {
          role: "system",
          content:
            "You are a helpful auto-complition assistant. Complete the user's sentence. Do not include the user's sentence in your response. If the user's sentence ends with a whitespace, do not start your response with a whitespace.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 32,
      temperature: 0.7,
    });

    const answer = result.choices?.[0]?.message?.content;
    postMessage({ type: "completion", text: answer });
  } catch (err) {
    postMessage({ type: "error", error: String(err) });
  }
};
