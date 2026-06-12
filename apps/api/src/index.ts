import "./loadEnv";
import { env } from "./lib/env";
import { createHttpServer } from "./server";

// Safety net (P3-00): Express 4 does not forward async handler rejections to
// the error handler; without this, one thrown `await` in a not-yet-wrapped
// route kills the process (Railway answers 502). Log and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const httpServer = createHttpServer();
const port = Number.parseInt(env.PORT, 10);

httpServer.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
