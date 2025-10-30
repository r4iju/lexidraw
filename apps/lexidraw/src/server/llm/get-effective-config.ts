"use server";

import { drizzle, schema, eq } from "@packages/drizzle";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { LLMMode } from "~/server/api/routers/admin/llm.policy.schemas";

export type LlmBaseConfig = {
  provider: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
};

export type UserLlmConfig = {
  chat?: Partial<LlmBaseConfig> & {
    extraConfig?: Record<string, unknown>;
  };
  agent?: Partial<LlmBaseConfig> & {
    extraConfig?: Record<string, unknown>;
  };
  autocomplete?: Partial<LlmBaseConfig> & {
    enabled?: boolean;
    reasoningEffort?: "minimal" | "standard" | "heavy";
    verbosity?: "low" | "medium" | "high";
    extraConfig?: Record<string, unknown>;
  };
};

export type EffectiveLlmConfig = LlmBaseConfig & {
  extraConfig?: Record<string, unknown>;
};

/**
 * Gets the effective LLM configuration for a given mode by:
 * 1. Fetching policy defaults from database
 * 2. Merging user config overrides
 * 3. Validating allowed models
 * 4. Applying enforced caps
 *
 * @param params.mode - The LLM mode: 'chat', 'agent', or 'autocomplete'
 * @param params.drizzle - Database instance (optional, uses global if not provided)
 * @param params.schema - Schema instance (optional, uses global if not provided)
 * @param params.userConfig - User's config overrides (optional)
 * @returns Effective configuration with provider, modelId, temperature, maxOutputTokens
 * @throws Error if no policy exists for the given mode
 */
export async function getEffectiveLlmConfig(params: {
  mode: LLMMode;
  drizzle?: LibSQLDatabase<typeof schema>;
  schema?: typeof schema;
  userConfig?: UserLlmConfig;
}): Promise<EffectiveLlmConfig> {
  const db = params.drizzle ?? drizzle;
  const sch = params.schema ?? schema;

  // Step 1: Fetch policy from database
  const [policyRow] = await db
    .select({
      provider: sch.llmPolicies.provider,
      modelId: sch.llmPolicies.modelId,
      temperature: sch.llmPolicies.temperature,
      maxOutputTokens: sch.llmPolicies.maxOutputTokens,
      allowedModels: sch.llmPolicies.allowedModels,
      enforcedCaps: sch.llmPolicies.enforcedCaps,
      extraConfig: sch.llmPolicies.extraConfig,
    })
    .from(sch.llmPolicies)
    .where(eq(sch.llmPolicies.mode, params.mode))
    .limit(1);

  if (!policyRow) {
    throw new Error(
      `No policy found for mode: ${params.mode}. Please create a policy in the admin panel.`,
    );
  }

  const policyDefaults = {
    provider: policyRow.provider,
    modelId: policyRow.modelId,
    temperature: policyRow.temperature,
    maxOutputTokens: policyRow.maxOutputTokens,
    allowedModels: policyRow.allowedModels,
    enforcedCaps: policyRow.enforcedCaps,
    extraConfig: policyRow.extraConfig ?? {},
  };

  // Step 2: Merge user config overrides
  const userOverride = params.userConfig?.[params.mode];
  const mergedConfig: LlmBaseConfig = userOverride
    ? {
        provider: userOverride.provider ?? policyDefaults.provider,
        modelId: userOverride.modelId ?? policyDefaults.modelId,
        temperature: userOverride.temperature ?? policyDefaults.temperature,
        maxOutputTokens:
          userOverride.maxOutputTokens ?? policyDefaults.maxOutputTokens,
      }
    : {
        provider: policyDefaults.provider,
        modelId: policyDefaults.modelId,
        temperature: policyDefaults.temperature,
        maxOutputTokens: policyDefaults.maxOutputTokens,
      };

  // Step 3: Validate allowed models
  let finalModelId = mergedConfig.modelId;
  let finalProvider = mergedConfig.provider;
  if (policyDefaults.allowedModels && policyDefaults.allowedModels.length > 0) {
    const isAllowed = policyDefaults.allowedModels.some(
      (allowed) =>
        allowed.provider === mergedConfig.provider &&
        allowed.modelId === mergedConfig.modelId,
    );
    if (!isAllowed) {
      // User's model is not in allowed list, use policy default
      finalModelId = policyDefaults.modelId;
      finalProvider = policyDefaults.provider;
      console.warn(
        `[getEffectiveLlmConfig] Model ${mergedConfig.provider}:${mergedConfig.modelId} not in allowedModels for mode ${params.mode}, using policy default ${finalProvider}:${finalModelId}`,
      );
    }
  }

  // Step 4: Apply enforced caps
  const enforcedCaps = policyDefaults.enforcedCaps?.maxOutputTokensByProvider;
  if (!enforcedCaps) {
    throw new Error(
      `Policy for mode ${params.mode} is missing enforcedCaps.maxOutputTokensByProvider`,
    );
  }
  const providerCap = enforcedCaps[finalProvider as keyof typeof enforcedCaps];
  if (providerCap === undefined) {
    throw new Error(
      `Policy for mode ${params.mode} is missing enforcedCaps for provider: ${finalProvider}`,
    );
  }
  const cappedMaxTokens = Math.min(mergedConfig.maxOutputTokens, providerCap);

  // Step 5: Merge extraConfig (policy defaults + user overrides)
  const policyExtraConfig = policyDefaults.extraConfig ?? {};
  const userExtraConfig = params.userConfig?.[params.mode]?.extraConfig;
  const mergedExtraConfig = userExtraConfig
    ? { ...policyExtraConfig, ...userExtraConfig }
    : policyExtraConfig;

  return {
    provider: finalProvider,
    modelId: finalModelId,
    temperature: mergedConfig.temperature,
    maxOutputTokens: cappedMaxTokens,
    extraConfig:
      Object.keys(mergedExtraConfig).length > 0 ? mergedExtraConfig : undefined,
  };
}
