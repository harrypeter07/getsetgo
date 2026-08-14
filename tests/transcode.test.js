/**
 * tests/transcode.test.js
 * Run with: node tests/transcode.test.js
 * (Or integrate into Jest with jest config pointing at this file)
 */

'use strict';

const { transcodeToHLS } = require('../scripts/transcode');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const TEST_VIDEO_PATH = process.env.TEST_VIDEO ?? path.join(__dirname, 'fixtures', 'sample-720p.mp4');
const SHORT_VIDEO_PATH = process.env.SHORT_VIDEO ?? path.join(__dirname, 'fixtures', 'sample-short.mp4');
const INVALID_VIDEO_PATH = path.join(__dirname, 'fixtures', 'invalid.bin');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

function probeSegment(segPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    segPath,
  ]).toString();
  return JSON.parse(out);
}

async function runTests() {
  console.log('\n🔬 Running transcode tests...\n');

  // ── Test 1: Normal 720p video produces expected quality subfolders ──────────
  await test('720p source → generates ≥3 quality levels with correct folders', async () => {
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      throw new Error(`Test video not found at ${TEST_VIDEO_PATH}. Set TEST_VIDEO env var or place a sample at tests/fixtures/sample-720p.mp4`);
    }

    const outputDir = path.join(os.tmpdir(), `transcode-test-${Date.now()}`);
    const result = await transcodeToHLS(TEST_VIDEO_PATH, outputDir);

    assert(result.qualities.length >= 3, `Expected ≥3 qualities, got ${result.qualities.length}`);
    assert(fs.existsSync(result.masterManifestPath), 'master.m3u8 not found');
    assert(result.durationSeconds > 0, 'durationSeconds should be > 0');
    assert(result.ffmpegVersion !== 'unknown', 'ffmpegVersion should be detected');
    assert(result.transcodeTimeMs > 0, 'transcodeTimeMs should be > 0');

    for (const q of result.qualities) {
      const qualityDir = path.join(outputDir, q.label);
      assert(fs.existsSync(qualityDir), `Quality dir missing: ${q.label}`);
      const playlist = path.join(qualityDir, 'playlist.m3u8');
      assert(fs.existsSync(playlist), `playlist.m3u8 missing for ${q.label}`);
      const segments = fs.readdirSync(qualityDir).filter((f) => f.endsWith('.ts'));
      assert(segments.length > 0, `No .ts segments found for ${q.label}`);
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Test 2: Master manifest contains BANDWIDTH and RESOLUTION tags ─────────
  await test('master.m3u8 contains BANDWIDTH and RESOLUTION per variant', async () => {
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      throw new Error(`Test video not found at ${TEST_VIDEO_PATH}`);
    }

    const outputDir = path.join(os.tmpdir(), `transcode-manifest-test-${Date.now()}`);
    const result = await transcodeToHLS(TEST_VIDEO_PATH, outputDir);

    const manifest = fs.readFileSync(result.masterManifestPath, 'utf8');
    assert(manifest.includes('BANDWIDTH='), 'master.m3u8 missing BANDWIDTH tag');
    assert(manifest.includes('RESOLUTION='), 'master.m3u8 missing RESOLUTION tag');
    assert(manifest.includes('#EXTM3U'), 'master.m3u8 missing #EXTM3U header');

    for (const q of result.qualities) {
      assert(manifest.includes(`${q.label}/playlist.m3u8`), `master.m3u8 missing reference to ${q.label}`);
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Test 3: Corrupt/invalid input throws a clear error ─────────────────────
  await test('invalid input file throws clear error (no silent failure)', async () => {
    // Create a fake binary file
    fs.mkdirSync(path.dirname(INVALID_VIDEO_PATH), { recursive: true });
    fs.writeFileSync(INVALID_VIDEO_PATH, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]));

    const outputDir = path.join(os.tmpdir(), `transcode-invalid-test-${Date.now()}`);
    let threw = false;
    try {
      await transcodeToHLS(INVALID_VIDEO_PATH, outputDir);
    } catch (err) {
      threw = true;
      assert(err.message.length > 10, 'Error message should be descriptive');
    }
    assert(threw, 'Expected an error for invalid input but none was thrown');
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Test 4: Missing input file throws clearly ───────────────────────────────
  await test('missing input file throws clear error', async () => {
    let threw = false;
    try {
      await transcodeToHLS('/nonexistent/path/video.mp4', os.tmpdir());
    } catch (err) {
      threw = true;
      assert(err.message.includes('not found') || err.message.includes('nonexistent'), `Unexpected error: ${err.message}`);
    }
    assert(threw, 'Expected an error for missing file');
  });

  // ── Test 5: Short video (<6s, shorter than one segment) ────────────────────
  await test('very short video (<6s) handles gracefully without crash', async () => {
    if (!fs.existsSync(SHORT_VIDEO_PATH)) {
      console.log('    ⚠️  Skipping: place a <6s video at tests/fixtures/sample-short.mp4 to enable this test.');
      passed--; // don't count skip as pass or fail
      return;
    }

    const outputDir = path.join(os.tmpdir(), `transcode-short-test-${Date.now()}`);
    const result = await transcodeToHLS(SHORT_VIDEO_PATH, outputDir);
    assert(result.qualities.length >= 1, 'Should produce at least 1 quality level');
    assert(fs.existsSync(result.masterManifestPath), 'master.m3u8 should exist');
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
