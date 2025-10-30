PRAGMA foreign_keys=OFF;
-- Add extraConfig column to LLMPolicies table
-- This stores mode-specific extra configurations (e.g., reasoningEffort, verbosity for autocomplete)
ALTER TABLE `LLMPolicies` ADD COLUMN `extraConfig` text;
PRAGMA foreign_keys=ON;
