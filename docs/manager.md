# Manager

## Overview

The Manager service is a central component of the Propeller system, responsible for managing tasks and proplets. It provides a set of APIs for task and proplet management, handles task scheduling and execution, and monitors the state of tasks and proplets. The architecture of the Manager service is designed to be modular, scalable, and maintainable, leveraging various components and middleware to achieve these goals.

## Architectural Components

### 1. Service Interface

The `Service` interface defines the core functionalities provided by the Manager service. It includes methods for managing proplets and tasks, as well as for subscribing to MQTT topics. This interface ensures that the service can be easily extended or replaced with different implementations.

### 2. API Endpoints

The Manager service exposes several HTTP endpoints for interacting with tasks and proplets. These endpoints are implemented using the Go-Kit library, which provides a structured way to define and handle HTTP requests and responses.

### 3. Middleware

The Manager service includes several middleware components that enhance its functionality:

- **Logging Middleware:** Logs the details of each service method call, including the duration and any errors that occurred.
- **Metrics Middleware:** Collects metrics for each service method call, such as the number of calls and the latency.
- **Tracing Middleware:** Adds tracing information to each service method call, using OpenTelemetry to provide distributed tracing capabilities.

### 4. Storage

The Manager service uses storage components to persist tasks and proplets. These storage components are abstracted behind interfaces, allowing for different storage implementations (e.g., in-memory, database) to be used interchangeably. The storage components include:

- **Tasks Storage:** Stores task details.
- **Proplets Storage:** Stores proplet details.
- **Task-Proplet Mapping Storage:** Stores the mapping between tasks and proplets.

### 5. Scheduler

The Manager service uses a scheduler to select the appropriate proplet for a task based on certain criteria. The scheduler is responsible for distributing tasks across available proplets in an efficient manner, ensuring optimal resource utilization. The current implementation supports two scheduling strategies:

- **Round-Robin Scheduler:** Selects the next available proplet in a cyclic manner.
- **Priority Scheduler:** Wraps an underlying scheduler and orders task execution by priority (higher values execute first), falling back to creation-time ordering for equal priorities.

### 6. PubSub

The Manager service uses a PubSub component to publish and subscribe to MQTT topics for task and proplet management. This component allows the service to communicate with other components of the Propeller system, such as proplets, to coordinate task execution and monitor their state.

### 7. Internal Handlers

The Manager service includes internal handlers for managing proplets and tasks. These handlers are responsible for processing messages received from MQTT topics and updating the state of tasks and proplets accordingly. The handlers include:

- **Proplet Handlers:** Handle the creation, liveness updates, and result updates of proplets.
- **Task Handlers:** Handle the creation, updating, and deletion of tasks.

### 8. Health and Metrics Endpoints

The Manager service includes endpoints for health checks and metrics collection:

- **Health Endpoint:** Provides a health check endpoint (`/health`) that returns the health status of the service.
- **Metrics Endpoint:** Provides a metrics endpoint (`/metrics`) that exposes Prometheus metrics for the service.

## Data Flow

### 1. Task Creation

- A client sends a `POST` request to the `/tasks` endpoint with the task details.
- The service creates a new task, assigns a unique ID, and stores it in the tasks storage.
- The service returns the created task to the client.

### 2. Task Execution

- A client sends a `POST` request to the `/tasks/{taskID}/start` endpoint to start a task.
- The service retrieves the task from the tasks storage and selects an appropriate proplet using the scheduler.
- The task can also specify which proplet to use.
- The service publishes a start message to the MQTT topic for the selected proplet.
- The proplet executes the task and publishes the results to the MQTT topic.
- The service processes the results and updates the task state in the tasks storage.

### 3. Proplet Management

- Proplets periodically send liveness updates to the MQTT topic.
- The service processes the liveness updates and updates the state of the proplets in the proplets storage.
- The service can also handle the creation of new proplets and the updating of proplet details.

## Task Scheduling and Priority

The Manager supports scheduled cron tasks and task priority scheduling, enabling automated recurring task execution and priority-based task ordering.

### Task Configuration Fields

When creating or updating a task, the following scheduling and priority fields are available:

| Field          | Type      | Required | Default | Description                                              |
| -------------- | --------- | -------- | ------- | -------------------------------------------------------- |
| `schedule`     | `string`  | No       | `""`    | Cron expression defining when the task should run        |
| `is_recurring` | `boolean` | No       | `false` | Whether the task should repeat after each execution      |
| `timezone`     | `string`  | No       | `"UTC"` | IANA timezone for interpreting the cron schedule          |
| `priority`     | `integer` | No       | `50`    | Task priority from 0 to 100 (higher = higher priority)   |
| `next_run`     | `string`  | No       | -       | Read-only. Calculated next execution time (RFC 3339)     |

### Cron Expressions

The `schedule` field uses standard 5-field cron expressions:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Common examples:

| Expression        | Description                   |
| ----------------- | ----------------------------- |
| `*/5 * * * *`     | Every 5 minutes               |
| `0 * * * *`       | Every hour                    |
| `0 9 * * *`       | Daily at 9:00 AM              |
| `0 9 * * MON-FRI` | Weekdays at 9:00 AM           |
| `0 0 1 * *`       | First day of each month       |
| `30 2 * * 0`      | Sundays at 2:30 AM            |

### Recurring vs One-Time Tasks

- **Recurring tasks** (`is_recurring: true`): Automatically re-scheduled after each execution. The system calculates the next execution time based on the cron expression and updates `next_run`.
- **One-time tasks** (`is_recurring: false` or omitted): Run once at the next matching time. After execution, the `schedule` and `next_run` fields are cleared.

### Task Priority

Tasks are assigned a priority value between 0 and 100:

- **Default:** 50 (applied when priority is not specified or set to 0)
- **Ordering:** Higher values indicate higher priority
- **Tie-breaking:** Tasks with equal priority are ordered by creation time (FIFO)

### Cron Scheduler Behavior

1. On startup, the Manager loads all tasks with a `schedule` from persistent storage and recalculates `next_run` for any tasks whose scheduled time has passed.
2. A background ticker checks every minute for tasks where `next_run` is due.
3. When a task is due, the scheduler calls `StartTask` to execute it.
4. For recurring tasks, `next_run` is recalculated for the next matching time.
5. For one-time tasks, the `schedule` and `next_run` fields are cleared after execution.

### Validation Rules

- **Schedule:** Must be a valid 5-field cron expression when provided.
- **Priority:** Must be between 0 and 100 (inclusive).
- **Timezone:** Must be a valid IANA timezone (e.g., `America/New_York`, `Europe/London`). Falls back to `UTC` if invalid.

### API Examples

#### Create a Recurring Scheduled Task

```bash
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Report Generation",
    "image_url": "ghcr.io/example/report-gen:latest",
    "schedule": "0 9 * * *",
    "is_recurring": true,
    "timezone": "America/New_York",
    "priority": 75
  }'
```

#### Create a One-Time Scheduled Task

```bash
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Maintenance Job",
    "image_url": "ghcr.io/example/maintenance:latest",
    "schedule": "0 2 15 * *",
    "is_recurring": false,
    "priority": 100
  }'
```

#### Create a High-Priority Task (No Schedule)

```bash
curl -X POST http://localhost:7070/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Critical Alert Handler",
    "image_url": "ghcr.io/example/alert-handler:latest",
    "priority": 95
  }'
```

#### Update a Task Schedule

```bash
curl -X PUT http://localhost:7070/tasks/{taskID} \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": "0 10 * * MON-FRI",
    "is_recurring": true,
    "timezone": "Europe/London"
  }'
```

#### Update Task Priority

```bash
curl -X PUT http://localhost:7070/tasks/{taskID} \
  -H "Content-Type: application/json" \
  -d '{
    "priority": 80
  }'
```

#### Remove a Task Schedule

```bash
curl -X PUT http://localhost:7070/tasks/{taskID} \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": ""
  }'
```
