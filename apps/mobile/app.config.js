module.exports = {
  name: "FamLink",
  slug: "famlink",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "famlink",
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  },
};
