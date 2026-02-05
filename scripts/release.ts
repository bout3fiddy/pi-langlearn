import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";

const BUMP_TYPES = ["patch", "minor", "major", "prepatch", "preminor", "premajor", "prerelease"] as const;
type BumpType = (typeof BUMP_TYPES)[number];

type RunOptions = { allowFailure?: boolean };

async function run(command: string[], options: RunOptions = {}): Promise<number> {
	const proc = Bun.spawn({
		cmd: command,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0 && !options.allowFailure) {
		throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
	}
	return exitCode;
}

async function capture(command: string[]): Promise<string> {
	const proc = Bun.spawn({
		cmd: command,
		stdout: "pipe",
		stderr: "inherit",
	});
	const outputText = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
	}
	return outputText;
}

function isBumpType(value: string): value is BumpType {
	return (BUMP_TYPES as readonly string[]).includes(value);
}

async function promptForBumpType(): Promise<BumpType> {
	const rl = createInterface({ input, output });
	const answer = await rl.question(`Version bump (${BUMP_TYPES.join("/")}) [patch]: `);
	rl.close();
	const normalized = answer.trim().toLowerCase();
	if (!normalized) return "patch";
	if (!isBumpType(normalized)) {
		throw new Error(`Unsupported bump type: ${normalized}`);
	}
	return normalized;
}

const args = process.argv.slice(2);
const useGitTag = args.includes("--git-tag");
const pushAfter = args.includes("--push");
const bumpArg = args.find((arg) => !arg.startsWith("--"));
const bumpType = bumpArg ? bumpArg.trim().toLowerCase() : await promptForBumpType();
if (!isBumpType(bumpType)) {
	throw new Error(`Unsupported bump type: ${bumpType}`);
}

const status = (await capture(["git", "status", "--porcelain"])).trim();
if (status) {
	throw new Error("Working tree not clean. Commit or stash changes before release.");
}

await run(["bun", "install"]);
await run(["bun", "run", "build"]);

await run(["bunx", "npm", "version", bumpType, "--no-git-tag-version"]);

const pkg = await Bun.file("package.json").json();
const version = typeof pkg?.version === "string" ? pkg.version : "";
const filesToAdd = ["package.json"];
if (existsSync("bun.lockb")) filesToAdd.push("bun.lockb");
await run(["git", "add", ...filesToAdd]);
await run(["git", "commit", "-m", `chore: release v${version || "unknown"}`]);

if (useGitTag && version) {
	await run(["git", "tag", `v${version}`]);
}

const whoamiExit = await run(["bunx", "npm", "whoami"], { allowFailure: true });
if (whoamiExit !== 0) {
	await run(["bunx", "npm", "login"]);
}

await run(["bunx", "npm", "publish", "--access", "public"]);

if (pushAfter) {
	await run(["git", "push", "--follow-tags"]);
}
