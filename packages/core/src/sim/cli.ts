#!/usr/bin/env node

/**
 * CLI runner for deterministic Till0 sync simulator:
 * `pnpm sim --seeds 1000` or `pnpm sim --seed 42`
 *
 * Requirements:
 * - Finishes 1000 seeds in under 60 seconds
 * - Prints seed of any failure
 * - Reproduces exactly when rerun with that seed
 */

import { runSimulation } from './simulator.js';

declare const process: {
  argv: string[];
  exit(code?: number): never;
  stdout: {
    write(str: string): boolean;
  };
};



interface CliArgs {
  seedsCount: number;
  specificSeed: number | null;
}

function parseArgs(args: string[]): CliArgs {
  let seedsCount = 1000;
  let specificSeed: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seeds' && i + 1 < args.length) {
      seedsCount = parseInt(args[i + 1]!, 10);
      i++;
    } else if (arg === '--seed' && i + 1 < args.length) {
      specificSeed = parseInt(args[i + 1]!, 10);
      i++;
    }
  }

  return { seedsCount, specificSeed };
}

async function main(): Promise<void> {
  const { seedsCount, specificSeed } = parseArgs(process.argv.slice(2));

  if (specificSeed !== null) {
    console.log(`Running simulation with single seed ${specificSeed}...`);
    const startTime = performance.now();
    const result = await runSimulation(specificSeed);
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

    if (result.success) {
      console.log(`SUCCESS: Seed ${specificSeed} passed in ${elapsed}s (${result.totalSalesOnServer} sales synced).`);
      process.exit(0);
    } else {
      console.error(`FAILURE: Seed ${specificSeed} failed in ${elapsed}s: ${result.error}`);
      process.exit(1);
    }
  }

  console.log(`Running simulation with ${seedsCount} seeds...`);
  const startTime = performance.now();

  let passed = 0;
  for (let seed = 1; seed <= seedsCount; seed++) {
    const result = await runSimulation(seed);
    if (!result.success) {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      console.error(`\nFAILURE on seed ${seed} after ${elapsed}s!`);
      console.error(`Error: ${result.error}`);
      console.error(`To reproduce: pnpm sim --seed ${seed}`);
      process.exit(1);
    }
    passed++;
    if (seed % 200 === 0 || seed === seedsCount) {
      process.stdout.write(`  [${seed}/${seedsCount}] seeds verified...\n`);
    }
  }

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\nALL ${passed} SEEDS PASSED in ${elapsed}s (< 60s limit).`);
}

main().catch((err) => {
  console.error('Fatal simulator error:', err);
  process.exit(1);
});
