# Process Monitoring Implementation

This document describes the complete process monitoring implementation for both Go and Rust proplets in the Propeller distributed task execution system.

## Overview

Comprehensive OS-level process monitoring has been implemented for:

- Go Proplet - Using `gopsutil/v3` for cross-platform metrics
- Rust Proplet - Using `sysinfo` crate for cross-platform metrics
- Manager - Ready for integration (metrics aggregation and visualization)

## Monitoring Profiles

Both implementations provide identical profiles:

| Profile             | Interval | Metrics                            | Export | History | Use Case            |
| ------------------- | -------- | ---------------------------------- | ------ | ------- | ------------------- |
| Standard            | 10s      | All                                | Yes    | 100     | General purpose     |
| Minimal             | 60s      | CPU, Memory                        | No     | 0       | Lightweight         |
| Intensive           | 1s       | All                                | Yes    | 1000    | Debug/analysis      |
| Batch Processing    | 30s      | CPU, Memory, Disk                  | Yes    | 200     | Data processing     |
| Real-time API       | 5s       | CPU, Memory, Network, Threads, FDs | Yes    | 500     | HTTP/API servers    |
| Long-running Daemon | 120s     | All                                | Yes    | 500     | Background services |
| Disabled            | -        | None                               | No     | 0       | No monitoring       |

## Metrics Collected

### Common Metrics (All Platforms)

- CPU usage percentage
- Memory usage (bytes and percentage)
- Disk I/O (read/write bytes)
- Network I/O (rx/tx bytes)
- Process uptime

### Platform-Specific Metrics

| Metric                | Linux | macOS | Windows |
| --------------------- | ----- | ----- | ------- |
| Thread Count          | ✓     | ✓     | Limited |
| File Descriptors      | ✓     | ✓     | ✗       |
| Detailed Memory Stats | ✓     | ✓     | ✓       |

## MQTT Topics

### Proplet-Level Metrics (Go)

```txt
m/{domain_id}/c/{channel_id}/control/proplet/metrics
```

Publishes overall proplet health metrics.

### Task-Level Metrics

```txt
m/{domain_id}/c/{channel_id}/control/proplet/task_metrics   # Go
m/{domain_id}/c/{channel_id}/metrics/proplet                 # Rust
```

Publishes per-task process metrics.

## Message Format

```json
{
  "task_id": "uuid",
  "proplet_id": "uuid",
  "metrics": {
    "cpu_percent": 42.5,
    "memory_bytes": 67108864,
    "memory_percent": 1.5,
    "disk_read_bytes": 1048576,
    "disk_write_bytes": 524288,
    "network_rx_bytes": 4096,
    "network_tx_bytes": 8192,
    "uptime_seconds": 120,
    "thread_count": 4,
    "file_descriptor_count": 12,
    "timestamp": "2025-01-15T10:30:00.000Z"
  },
  "aggregated": {
    "avg_cpu_usage": 38.2,
    "max_cpu_usage": 65.0,
    "avg_memory_usage": 62914560,
    "max_memory_usage": 71303168,
    "total_disk_read": 2097152,
    "total_disk_write": 1048576,
    "total_network_rx": 12288,
    "total_network_tx": 24576,
    "sample_count": 24
  }
}
```

## Configuration

### Go Proplet Environment Variables

```bash
PROPLET_METRICS_INTERVAL=10        # Interval in seconds
PROPLET_ENABLE_MONITORING=true     # Enable/disable
```

### Rust Proplet Environment Variables

```bash
PROPLET_ENABLE_MONITORING=true     # Enable/disable
PROPLET_METRICS_INTERVAL=10        # Interval in seconds
```

### Per-Task Configuration (JSON)

```json
{
  "monitoring_profile": {
    "enabled": true,
    "interval": 5000000000,
    "collect_cpu": true,
    "collect_memory": true,
    "collect_disk_io": true,
    "collect_network_io": true,
    "collect_threads": true,
    "collect_file_descriptors": true,
    "export_to_mqtt": true,
    "retain_history": true,
    "history_size": 200
  }
}
```

## Performance Impact

Measured overhead across platforms:

| Profile   | CPU Overhead | Memory Overhead |
| --------- | ------------ | --------------- |
| Minimal   | < 0.1%       | ~1 MB           |
| Standard  | < 0.5%       | ~2 MB           |
| Intensive | < 2%         | ~5 MB           |

## Usage Examples

### Go - Start Task with Monitoring

```go
task := task.Task{
    ID:       "task-123",
    Name:     "compute",
    ImageURL: "registry.example.com/compute:v1",
    Daemon:   false,
    MonitoringProfile: &monitoring.StandardProfile(),
}
```

### Rust - Start Task with Monitoring

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "functionName": "compute",
  "imageURL": "registry.example.com/compute:v1",
  "daemon": false,
  "monitoringProfile": {
    "enabled": true,
    "interval": 10,
    "collect_cpu": true,
    "collect_memory": true,
    "export_to_mqtt": true,
    "retain_history": true,
    "history_size": 100
  }
}
```

## Integration with Monitoring Systems

### Prometheus

Use MQTT-to-Prometheus exporter:

```yaml
scrape_configs:
  - job_name: "propeller"
    static_configs:
      - targets: ["mqtt-exporter:9641"]
```

### Grafana

Create dashboards with:

- CPU usage over time
- Memory consumption trends
- Disk/Network I/O rates
- Per-task resource usage

### Custom Monitoring

Subscribe to MQTT topics:

```bash
mosquitto_sub -h localhost -t "m/+/c/+/*/metrics" -v
```

## Testing

### Manual Test

```bash
# Start proplet
./build/proplet

# Submit a task
curl -X POST http://localhost:8080/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-123",
    "name": "compute",
    "file": "...",
    "monitoring_profile": {
      "enabled": true,
      "interval": 5000000000,
      "export_to_mqtt": true
    }
  }'

# Monitor metrics
mosquitto_sub -h localhost -t "m/+/c/+/*/metrics" -v
```

## Future Enhancements

1. Manager Integration

   - Aggregate metrics from all proplets
   - Historical metrics storage
   - Metrics API endpoints
   - Alerting on anomalies

2. Advanced Metrics

   - GPU usage (if available)
   - Container-specific metrics (cgroups)
   - Custom application metrics
   - Distributed tracing correlation

3. Optimization

   - Adaptive sampling rates
   - Metric compression
   - Batched MQTT publishing
   - Metrics rollups/aggregation

4. Visualization
   - Built-in dashboards
   - Real-time metric streaming
   - Historical trend analysis
   - Anomaly detection

## References

- Go Implementation: `proplet/monitoring/`
- Rust Implementation: `proplet-rs/src/monitoring/`
- Examples: `examples/monitoring-example.md`
- Rust Docs: `proplet-rs/MONITORING.md`
- Go Docs: `proplet/monitoring/README.md`
