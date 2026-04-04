const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "src", "generated");
const dest = path.join(__dirname, "..", "dist", "generated");

if (!fs.existsSync(src)) {
  console.error(
    "[@famlink/db] dist build needs src/generated — run `prisma generate` in packages/db first."
  );
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
