import { debounce } from './debounce'

/** How long after the last change a recovery draft is written. Exported so
    App.svelte passes it explicitly, which lets App.test.ts mock it short. */
export const DRAFT_DEBOUNCE_MS = 2000

/** The Go side of the drafts: WriteDraft and DiscardDraft in App.svelte. */
export interface DraftSink {
  write(docPath: string, content: string): Promise<void>
  discard(docPath: string): Promise<void>
}

export interface DraftKeeper {
  /** Called from one $effect on every change to the path, the text, the
      dirty flag or the setting. docPath is '' for an unsaved document. */
  update(docPath: string, content: string, dirty: boolean, enabled: boolean): void
  /** The document was swapped for another: drop the pending write and
      forget the old document's dirty state, so the swap is not mistaken
      for a save. */
  reset(): void
  /** Resolves once every queued write and discard has finished. Awaited
      before quitting, so a Save-then-quit does not leave a draft behind. */
  settle(): Promise<void>
}

// The keeper decides *when*; recovery.go decides whether a draft is still
// worth offering. Two rules here: write only while dirty and enabled, a
// debounce after the last change; discard on the dirty-to-clean transition.
// Writes and discards go through one promise chain so a discard can never
// overtake a write that is still in flight and leave the draft it meant to
// remove on disk.
export function createDraftKeeper(sink: DraftSink, wait: number): DraftKeeper {
  let queue: Promise<void> = Promise.resolve()
  let wasDirty = false

  // The sink reports its own failures (App toasts a write failure); the
  // catch here only keeps a rejection from wedging every later operation.
  const enqueue = (op: () => Promise<void>) => {
    queue = queue.then(op).catch(() => {})
  }

  const scheduleWrite = debounce((docPath: string, content: string) => {
    enqueue(() => sink.write(docPath, content))
  }, wait)

  return {
    update(docPath, content, dirty, enabled) {
      if (dirty && enabled) scheduleWrite(docPath, content)
      else scheduleWrite.cancel()
      // Not gated on `enabled`: a draft written before the setting was
      // switched off still has to go when the document is saved.
      if (!dirty && wasDirty) enqueue(() => sink.discard(docPath))
      wasDirty = dirty
    },
    reset() {
      scheduleWrite.cancel()
      wasDirty = false
    },
    settle() {
      return queue
    },
  }
}
