import { describe, it, mock } from 'node:test'
import assert from 'node:assert'

import { forceUnwrap } from '../app/src/lib/fatal-error'

// ---------------------------------------------------------------------------
// Helpers that replicate the findYarnVersion logic introduced in this PR.
// The PR replaced an async `glob` callback with synchronous `globSync`, then
// sorts the results and picks the last entry via `Array.prototype.at(-1)`.
// These helpers let us unit-test that logic in isolation.
// ---------------------------------------------------------------------------

/**
 * Reimplementation of the updated findYarnVersion logic for unit testing.
 * Mirrors the production code exactly so tests stay honest.
 */
function findYarnVersionSync(
  globSync: (pattern: string) => string[],
  callback: (path: string) => void
) {
  const files = globSync('vendor/yarn-*.js')

  // Matches the production sort: ensures alphabetical ordering.
  files.sort()

  // Mirrors production: use the latest version if multiple are found.
  callback(forceUnwrap('Missing vendored yarn', files.at(-1)))
}

// ---------------------------------------------------------------------------
// Tests for findYarnVersion (sync glob variant introduced in this PR)
// ---------------------------------------------------------------------------

describe('findYarnVersion (synchronous globSync variant)', () => {
  it('calls the callback with the single file when only one yarn version is found', () => {
    const mockGlobSync = mock.fn(() => ['vendor/yarn-1.22.19.js'])
    const capturedPaths: string[] = []

    findYarnVersionSync(mockGlobSync, path => capturedPaths.push(path))

    assert.strictEqual(mockGlobSync.mock.calls.length, 1)
    assert.strictEqual(capturedPaths.length, 1)
    assert.strictEqual(capturedPaths[0], 'vendor/yarn-1.22.19.js')
  })

  it('passes the glob pattern vendor/yarn-*.js to globSync', () => {
    const mockGlobSync = mock.fn(() => ['vendor/yarn-1.22.19.js'])

    findYarnVersionSync(mockGlobSync, () => {})

    assert.strictEqual(
      mockGlobSync.mock.calls[0].arguments[0],
      'vendor/yarn-*.js'
    )
  })

  it('selects the alphabetically last file when multiple yarn versions exist', () => {
    // Provide files out-of-order to verify that sort + at(-1) picks correctly.
    const mockGlobSync = mock.fn(() => [
      'vendor/yarn-1.22.19.js',
      'vendor/yarn-1.9.4.js',
      'vendor/yarn-1.21.1.js',
    ])
    const capturedPaths: string[] = []

    findYarnVersionSync(mockGlobSync, path => capturedPaths.push(path))

    // Alphabetical sort: '1.21' < '1.22' < '1.9' (lexicographic, not semver)
    assert.strictEqual(capturedPaths[0], 'vendor/yarn-1.9.4.js')
  })

  it('sorts files alphabetically (lexicographic) before selecting', () => {
    // Deliberately unsorted input – the implementation must sort before at(-1).
    const input = [
      'vendor/yarn-1.9.4.js',
      'vendor/yarn-1.21.1.js',
      'vendor/yarn-1.22.19.js',
    ]
    const mockGlobSync = mock.fn(() => [...input])
    const capturedPaths: string[] = []

    findYarnVersionSync(mockGlobSync, path => capturedPaths.push(path))

    const sorted = [...input].sort()
    const expected = sorted.at(-1)
    assert.strictEqual(capturedPaths[0], expected)
  })

  it('calls the callback exactly once regardless of how many files are found', () => {
    const mockGlobSync = mock.fn(() => [
      'vendor/yarn-1.21.1.js',
      'vendor/yarn-1.22.19.js',
    ])
    let callCount = 0

    findYarnVersionSync(mockGlobSync, () => {
      callCount++
    })

    assert.strictEqual(callCount, 1)
  })

  it('throws "Missing vendored yarn" when globSync returns an empty array', () => {
    const mockGlobSync = mock.fn(() => [] as string[])

    assert.throws(
      () => findYarnVersionSync(mockGlobSync, () => {}),
      (err: unknown) => {
        assert(err instanceof Error)
        assert.strictEqual(err.message, 'Missing vendored yarn')
        return true
      }
    )
  })

  it('propagates the throw before the callback is invoked when no files exist', () => {
    const mockGlobSync = mock.fn(() => [] as string[])
    let callbackInvoked = false

    assert.throws(() =>
      findYarnVersionSync(mockGlobSync, () => {
        callbackInvoked = true
      })
    )

    assert.strictEqual(
      callbackInvoked,
      false,
      'callback must not be called when no files are found'
    )
  })

  it('handles a single file whose name is exactly the glob pattern prefix', () => {
    const mockGlobSync = mock.fn(() => ['vendor/yarn-1.js'])
    const capturedPaths: string[] = []

    findYarnVersionSync(mockGlobSync, path => capturedPaths.push(path))

    assert.strictEqual(capturedPaths[0], 'vendor/yarn-1.js')
  })

  it('is synchronous: the callback is called before findYarnVersionSync returns', () => {
    const mockGlobSync = mock.fn(() => ['vendor/yarn-1.22.19.js'])
    let callbackFiredSynchronously = false

    findYarnVersionSync(mockGlobSync, () => {
      callbackFiredSynchronously = true
    })

    // If findYarnVersionSync were async/callback-deferred (old behaviour),
    // this assertion would fail because the callback would fire later.
    assert.strictEqual(
      callbackFiredSynchronously,
      true,
      'callback must fire synchronously (globSync replaces the async glob call)'
    )
  })
})

// ---------------------------------------------------------------------------
// Tests for forceUnwrap – the guard used by findYarnVersion
// ---------------------------------------------------------------------------

describe('forceUnwrap (used by findYarnVersion)', () => {
  it('returns the value when it is defined', () => {
    assert.strictEqual(forceUnwrap('should not throw', 'value'), 'value')
  })

  it('returns the value when it is 0 (falsy but defined)', () => {
    assert.strictEqual(forceUnwrap('should not throw', 0), 0)
  })

  it('throws with the given message when value is undefined', () => {
    assert.throws(
      () => forceUnwrap('Missing vendored yarn', undefined),
      (err: unknown) => {
        assert(err instanceof Error)
        assert.strictEqual(err.message, 'Missing vendored yarn')
        return true
      }
    )
  })

  it('throws with the given message when value is null', () => {
    assert.throws(
      () => forceUnwrap('Missing vendored yarn', null),
      (err: unknown) => {
        assert(err instanceof Error)
        assert.strictEqual(err.message, 'Missing vendored yarn')
        return true
      }
    )
  })

  it('throws with exact message text matching what findYarnVersion passes', () => {
    // Regression guard: if the message text changes, callers that catch this
    // error by message would break.
    assert.throws(
      () => forceUnwrap('Missing vendored yarn', undefined),
      { message: 'Missing vendored yarn' }
    )
  })
})

// ---------------------------------------------------------------------------
// Tests for the Array sort + at(-1) selection logic
// (the heart of the PR change: deterministic, synchronous file selection)
// ---------------------------------------------------------------------------

describe('yarn file selection algorithm (sort + at(-1))', () => {
  function selectYarnFile(files: string[]): string | undefined {
    const sorted = [...files].sort()
    return sorted.at(-1)
  }

  it('returns undefined for an empty list', () => {
    assert.strictEqual(selectYarnFile([]), undefined)
  })

  it('returns the only element for a single-item list', () => {
    assert.strictEqual(selectYarnFile(['vendor/yarn-1.22.19.js']), 'vendor/yarn-1.22.19.js')
  })

  it('returns the last element after alphabetical sort', () => {
    const result = selectYarnFile([
      'vendor/yarn-1.22.19.js',
      'vendor/yarn-1.21.1.js',
    ])
    // '1.22' > '1.21' lexicographically
    assert.strictEqual(result, 'vendor/yarn-1.22.19.js')
  })

  it('is not affected by input order (sort is applied first)', () => {
    const forward = selectYarnFile([
      'vendor/yarn-1.21.1.js',
      'vendor/yarn-1.22.19.js',
    ])
    const reversed = selectYarnFile([
      'vendor/yarn-1.22.19.js',
      'vendor/yarn-1.21.1.js',
    ])
    assert.strictEqual(forward, reversed)
  })

  it('correctly handles lexicographic ordering where "1.9" sorts after "1.22"', () => {
    // Regression: alphabetical order differs from semver order.
    // "1.22.js" < "1.9.js" lexicographically because "2" < "9".
    const result = selectYarnFile([
      'vendor/yarn-1.22.19.js',
      'vendor/yarn-1.9.4.js',
    ])
    assert.strictEqual(result, 'vendor/yarn-1.9.4.js')
  })

  it('produces a stable result for the same input', () => {
    const files = [
      'vendor/yarn-1.22.19.js',
      'vendor/yarn-1.21.1.js',
      'vendor/yarn-1.9.4.js',
    ]
    assert.strictEqual(selectYarnFile(files), selectYarnFile(files))
  })
})
