import "./loadEnv";
import { env } from "./lib/env";
import { createHttpServer } from "./server";

const httpServer = createHttpServer();
const port = Number.parseInt(env.PORT, 10);

httpServer.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
