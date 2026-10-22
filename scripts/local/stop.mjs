import { run, config } from "./check.mjs";
import { stopArguments } from "./guard.mjs";
run("supabase", stopArguments(config.project));
console.log("JomCall stopped; database volumes retained.");
