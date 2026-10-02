// `output: "standalone"` omits static assets; copy them next to the server (Next docs: self-hosting).
import { cpSync, existsSync } from "node:fs";

const out = ".next/standalone/apps/web";
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${out}/public`, { recursive: true });
console.log("copied static assets into", out);
