// The auth config now lives in the shared @podbay/auth package so apps/web and
// the terminal gateway validate sessions identically. Re-exported here to keep
// existing imports stable.
export * from "@podbay/auth";
