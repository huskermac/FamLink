import { env } from "./lib/env";
import { createApp } from "./server";

const app = createApp();
const port = Number.parseInt(env.PORT, 10);

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
