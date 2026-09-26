/**
 * In-memory stand-in for the Supabase Storage bucket that certificate PDFs are
 * uploaded to. Only the external storage service is faked: everything else in
 * the fulfillment path (Prisma, transactions, compare-and-set) stays real.
 *
 * Usage (vi.mock factories are hoisted, so import inside the factory):
 *   vi.mock("@/lib/supabase/server", async () =>
 *     (await import("../setup/fakeCertificateStorage")).fakeSupabaseServer);
 */

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

export const certificateStorage = {
  objects: new Map<string, Uint8Array>(),
  uploadCounts: new Map<string, number>(),
  /** Number of upcoming uploads that fail. */
  failNext: 0,
  /** When set, uploads wait on it (to interleave a concurrent event). */
  gate: null as Deferred | null,
  /** Resolved when an upload reaches the gate. */
  reachedGate: null as Deferred | null,

  uploadsFor(certificateId: string): number {
    return this.uploadCounts.get(`certificates/${certificateId}.pdf`) ?? 0;
  },
  objectFor(certificateId: string): Uint8Array | undefined {
    return this.objects.get(`certificates/${certificateId}.pdf`);
  },
  /** Holds the next uploads until the returned release() is called. */
  hold() {
    this.gate = deferred();
    this.reachedGate = deferred();
    const gate = this.gate;
    return {
      reached: this.reachedGate.promise,
      release: () => {
        this.gate = null;
        gate.resolve();
      },
    };
  },
};

export const publicUrlFor = (certificateId: string) =>
  `https://storage.test/certificates/certificates/${certificateId}.pdf`;

export const fakeSupabaseServer = {
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          certificateStorage.uploadCounts.set(
            path,
            (certificateStorage.uploadCounts.get(path) ?? 0) + 1
          );
          if (certificateStorage.gate) {
            certificateStorage.reachedGate?.resolve();
            await certificateStorage.gate.promise;
          }
          if (certificateStorage.failNext > 0) {
            certificateStorage.failNext--;
            return { error: new Error("storage unavailable (test)") };
          }
          certificateStorage.objects.set(path, bytes);
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.test/${bucket}/${path}` },
        }),
      }),
    },
  }),
};
