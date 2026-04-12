export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Track services for graceful shutdown
    let cleanupService: { start: () => void; stop: () => void } | null = null;

    // --- Machine cleanup service (requires Supabase service role) ---
    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE) {
        const { getMachineCleanupService } = await import("@/lib/services/machine-cleanup");
        cleanupService = getMachineCleanupService();
        cleanupService.start();
        console.log('✅ Machine cleanup service started successfully');
      } else {
        console.warn('⚠️  Supabase service role not configured - machine cleanup disabled');
      }
    } catch (error) {
      console.error('❌ Failed to start machine cleanup service:', error);
    }

    // Status check persistence is handled by the backend (periodic_status_check
    // in main.py), so no frontend status checker is needed.

    // Graceful shutdown handling
    const shutdown = () => {
      console.log('🛑 Shutting down services...');
      try {
        cleanupService?.stop();
        console.log('✅ Services shut down successfully');
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('beforeExit', shutdown);
  }
}
