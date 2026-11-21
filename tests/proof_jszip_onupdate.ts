/**
 * Phase 0 — Standalone proof: does throwing inside JSZip onUpdate
 * settle the generateAsync promise?
 *
 * Run from project root: npx tsx tests/proof_jszip_onupdate.ts
 */
import JSZip from "jszip";

async function testOnUpdateThrow() {
  console.log("=== JSZip onUpdate throw test ===\n");

  const zip = new JSZip();
  // Add enough data so onUpdate fires multiple times
  for (let i = 0; i < 50; i++) {
    zip.file(`file_${i}.txt`, "x".repeat(10000));
  }

  let onUpdateCalls = 0;
  let promiseSettled = false;
  let settledAs: "resolved" | "rejected" | null = null;
  let errorCaught: Error | null = null;

  const ABORT_MSG = "AbortError: export cancelled";

  try {
    const result = await zip.generateAsync(
      { type: "uint8array" },
      (metadata) => {
        onUpdateCalls++;
        if (onUpdateCalls === 2) {
          // Throw on the 2nd update
          throw new Error(ABORT_MSG);
        }
      },
    );
    promiseSettled = true;
    settledAs = "resolved";
    console.log(`  Promise RESOLVED (unexpected). ZIP size: ${result.length} bytes`);
  } catch (err: any) {
    promiseSettled = true;
    settledAs = "rejected";
    errorCaught = err;
    console.log(`  Promise REJECTED with: ${err.message}`);
  }

  console.log(`  onUpdate was called ${onUpdateCalls} time(s)`);
  console.log(`  Promise settled: ${promiseSettled}`);
  console.log(`  Settled as: ${settledAs}`);

  if (settledAs === "rejected" && errorCaught?.message === ABORT_MSG) {
    console.log("\n✅ RESULT: Throwing in onUpdate DOES reject the generateAsync promise.");
    console.log("   The thrown error propagates correctly. The existing code is safe.");
  } else if (settledAs === "resolved") {
    console.log("\n⚠ RESULT: Throwing in onUpdate does NOT reject the promise.");
    console.log("   The promise resolved anyway. Need flag-based approach.");
  } else {
    console.log("\n⚠ RESULT: Promise rejected but with a different error:");
    console.log(`   ${errorCaught?.message}`);
  }

  // Also test: does an uncaught error handler fire?
  let uncaughtFired = false;
  process.on("uncaughtException", (err) => {
    uncaughtFired = true;
    console.log(`  ⚠ uncaughtException: ${err.message}`);
  });

  // Wait a moment to see if any delayed uncaught error appears
  await new Promise((r) => setTimeout(r, 500));

  if (!uncaughtFired) {
    console.log("  No uncaughtException fired (clean).");
  }

  console.log("\n=== Done ===");
}

testOnUpdateThrow().catch(console.error);
