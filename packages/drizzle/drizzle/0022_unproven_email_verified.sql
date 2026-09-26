-- Nothing had ever verified an email before Sign in with Apple, so any value
-- here was set by hand and must not count as proof when accounts link.
UPDATE `Users` SET `emailVerified` = NULL WHERE `emailVerified` IS NOT NULL;
