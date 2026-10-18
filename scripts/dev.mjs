import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "@hopnet/coordinator"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@hopnet/web"], { stdio: "inherit" }),
];

const stop = (signal) => {
  for (const child of children) child.kill(signal);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const [result] = await Promise.race(
  children.map((child) => new Promise((resolve) => child.once("exit", (code) => resolve([code, child])))),
);
stop("SIGTERM");
process.exit(result ?? 1);
