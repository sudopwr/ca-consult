import { createApp } from './composition-root.js';

async function main(): Promise<void> {
  const { server, outboxWorker, reminderWorker, pool, env } = await createApp();

  // In-process workers. Fine for a single-practitioner practice; if the API is
  // ever scaled to several instances, `for update skip locked` in the outbox
  // means running them everywhere is still safe.
  outboxWorker.start(15_000);
  reminderWorker.start(30 * 60_000);

  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;

      server.log.info({ signal }, 'shutting down');

      // Stop taking work, drain in-flight requests, then close the pool — so a
      // deploy never cuts a booking off mid-transaction.
      outboxWorker.stop();
      reminderWorker.stop();

      void server
        .close()
        .then(() => pool.end())
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          server.log.error({ err: error }, 'error during shutdown');
          process.exit(1);
        });
    });
  }

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  // Config and connection errors land here, before a logger exists.
  console.error('failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
