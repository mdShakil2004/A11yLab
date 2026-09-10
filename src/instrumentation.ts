export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (connectionString) {
      const { useAzureMonitor } = await import('@azure/monitor-opentelemetry');
      // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook; Azure Monitor SDK naming convention
      useAzureMonitor({
        azureMonitorExporterOptions: { connectionString },
        samplingRatio: 1.0,
        enableLiveMetrics: true,
      });
      console.log('[instrumentation] Azure Monitor OpenTelemetry initialized (sampling=100%, liveMetrics=on)');
    } else {
      console.log('[instrumentation] APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry export disabled');
    }
  }
}
