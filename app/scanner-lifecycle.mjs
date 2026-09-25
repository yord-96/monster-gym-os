// A new camera session must wait for the previous one to finish opening and close.
export function createScannerLifecycle() {
  let queue = Promise.resolve();
  return {
    open(create, initialize, onError) {
      let cancelled = false;
      let scanner;
      const ready = queue.then(async () => {
        if (cancelled) return;
        scanner = await create();
        if (!cancelled) await initialize(scanner, () => cancelled);
      }).catch(error => { if (!cancelled) onError(error); });
      queue = ready;
      return () => {
        if (cancelled) return queue;
        cancelled = true;
        queue = ready.then(async () => {
          if (!scanner) return;
          try { if (scanner.isScanning) await scanner.stop(); } catch { /* already stopped */ }
          try { await scanner.clear(); } catch { /* already cleared */ }
        });
        return queue;
      };
    },
  };
}
