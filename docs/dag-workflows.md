# Workflow DAG Scheduling, Dependencies, Conditional Execution, and Data Passing

## Overview

Propeller supports **workflow DAG scheduling** — a way to define multi-step task pipelines where each task can depend on the outcome of others, execute conditionally, and pass data forward to downstream tasks.

### What Is DAG Scheduling?

A DAG (Directed Acyclic Graph) is a way to describe workflows where tasks have dependencies but no circular references. Each task knows which tasks must finish before it can start, and the system automatically determines the correct execution order.

![DAG Basics](images/dag-basic.png)

In this example, **A** runs first. Once **A** completes, **B** and **C** run in parallel. **D** waits for both **B** and **C** to finish before it starts.

### Why Does This Exist?

Simple task scheduling treats every task as independent — you trigger them individually or on a timer. But real workloads often involve steps that must happen in a specific order: extract data before transforming it, transform before loading, and so on.

DAG scheduling solves this by letting you:

- **Declare dependencies** between tasks so the system enforces execution order.
- **Run independent tasks in parallel** to minimize total pipeline duration.
- **React to failures** with conditional tasks that handle errors or trigger cleanup.
- **Pass data between tasks** so downstream steps can use the results of upstream ones.

---

## Key Concepts

### Workflow

A workflow is a group of related tasks that share a common `workflow_id`. All tasks in a workflow are created together and their dependencies are validated as a unit. The system ensures the dependency graph is valid before accepting the workflow.

### Task

A task is a single unit of work within a workflow. Each task runs a container image and can produce results that other tasks consume. Tasks progress through states: **Pending**, **Running**, **Completed**, **Failed**, or **Skipped**.

### Dependency

A dependency is a relationship between two tasks. When Task B depends on Task A, Task B will not start until Task A reaches a terminal state (Completed, Failed, or Skipped). A task can depend on multiple parents, and multiple tasks can depend on the same parent.

![DAG Dependency](images/dag-dependency.png)

### Directed Acyclic Graph (DAG)

The dependency relationships between all tasks in a workflow form a DAG. The "acyclic" constraint means there can be no circular dependencies — if A depends on B, then B cannot depend on A (directly or indirectly). The system validates this at creation time and rejects invalid workflows.

### Conditional Execution

Each task can specify a `run_if` condition that controls whether it actually executes when its dependencies are met:

| Condition    | Behavior                                                       |
|--------------|----------------------------------------------------------------|
| `"success"`  | Run only if **all** parent tasks completed successfully (default) |
| `"failure"`  | Run if **at least one** parent task failed                     |

If the condition is not met, the task is marked as **Skipped** rather than running. Skipped tasks do not block downstream tasks — they count as a terminal state.

![Conditional Execution](images/dag-conditional-branching.png)

### Data Passing

Tasks can produce output stored in a `results` field. Downstream tasks automatically receive the results of all their parent tasks when they start. This enables pipelines where each step builds on the output of the previous one.

![Data Passing](images/data-passing-between-tasks.png)

### Execution Order Resolution

The system uses topological sorting to determine valid execution order. Tasks with no unmet dependencies become "ready" and are started. When multiple tasks are ready simultaneously, they execute in parallel (subject to available capacity) and are ordered by priority.

### Failure Handling

When a task fails:

- **Success-path dependents** (tasks with `run_if: "success"`) are blocked and will not run.
- **Failure-path dependents** (tasks with `run_if: "failure"`) are triggered, enabling error handling and cleanup workflows.
- The scheduler continues processing other tasks in the workflow — a single failure does not halt the entire pipeline.

---

## Defining a Workflow

### Creating a Workflow

Send a `POST` request to `/workflows` with all tasks defined in a single request. The system assigns a shared `workflow_id`, validates the dependency graph, and creates all tasks transactionally.

```json
POST /workflows

{
  "tasks": [
    {
      "name": "Extract Data",
      "image_url": "oci://registry.example.com/extract:latest",
      "depends_on": [],
      "priority": 70
    },
    {
      "name": "Transform Data",
      "image_url": "oci://registry.example.com/transform:latest",
      "depends_on": ["<extract-task-id>"],
      "run_if": "success",
      "priority": 70
    },
    {
      "name": "Load Data",
      "image_url": "oci://registry.example.com/load:latest",
      "depends_on": ["<transform-task-id>"],
      "run_if": "success",
      "priority": 70
    },
    {
      "name": "Handle Errors",
      "image_url": "oci://registry.example.com/error-handler:latest",
      "depends_on": ["<transform-task-id>"],
      "run_if": "failure",
      "priority": 90
    }
  ]
}
```

**Response (201 Created):**

```json
{
  "tasks": [
    {
      "id": "a1b2c3d4-...",
      "name": "Extract Data",
      "workflow_id": "wf-9876-...",
      "state": "Pending",
      "depends_on": [],
      "priority": 70,
      "created_at": "2026-02-12T10:00:00Z"
    },
    {
      "id": "e5f6g7h8-...",
      "name": "Transform Data",
      "workflow_id": "wf-9876-...",
      "state": "Pending",
      "depends_on": ["a1b2c3d4-..."],
      "run_if": "success",
      "priority": 70,
      "created_at": "2026-02-12T10:00:00Z"
    }
  ]
}
```

### Declaring Dependencies

Dependencies are declared using the `depends_on` field, which contains an array of task IDs:

```json
{
  "name": "Final Report",
  "depends_on": ["task-id-1", "task-id-2", "task-id-3"],
  "run_if": "success",
  "image_url": "oci://registry.example.com/report:latest"
}
```

This task waits for all three parent tasks to complete before starting.

**Rules:**

- Root tasks (no dependencies) use an empty array: `"depends_on": []`
- A task can depend on multiple parents — it waits for **all** of them.
- All referenced task IDs must exist within the same workflow.
- Dependencies must not form cycles.

### Configuring Conditional Execution

Set the `run_if` field on any task to control whether it runs based on parent outcomes:

**Run on success (default):**

```json
{
  "name": "Send Confirmation",
  "depends_on": ["payment-task-id"],
  "run_if": "success"
}
```

**Run on failure:**

```json
{
  "name": "Send Failure Alert",
  "depends_on": ["payment-task-id"],
  "run_if": "failure"
}
```

You can attach both a success-path and a failure-path task to the same parent to handle either outcome:

![Configuring Conditional Execution](images/run-if-success-failure-branching.png)

### Passing Data Between Tasks

When a task completes, its output is stored in the `results` field. When a downstream task starts, it automatically receives the results of all its parent tasks. The parent results are delivered as a map keyed by parent task ID:

```json
{
  "parent-task-id-1": {
    "processed_count": 1500,
    "output_path": "s3://bucket/results.csv"
  },
  "parent-task-id-2": {
    "status": "validated",
    "errors": []
  }
}
```

You can also retrieve a task's results explicitly via `GET /tasks/{taskID}/results`.

---

## Execution Model

### How the Scheduler Determines Task Order

1. When a workflow is created, the system validates the DAG and computes a topological ordering.
2. Root tasks (those with no dependencies) become immediately ready.
3. When a task completes, the scheduler evaluates all tasks that depend on it.
4. For each dependent task, it checks whether **all** dependencies have reached a terminal state.
5. If all dependencies are met and the `run_if` condition passes, the task is started.
6. If the `run_if` condition fails, the task is marked as **Skipped**.

### Parallel Execution

Tasks at the same level of the DAG (with no dependencies on each other) can run in parallel. The system starts all ready tasks simultaneously, subject to available capacity.

![Parallel Execution](images/dag-basic.png)

After **A** completes, **B** and **C** become ready and start in parallel. **D** waits for the two tasks to complete.

### Priority Within a Level

When multiple tasks become ready at the same time, they are ordered by priority:

1. Higher priority tasks (closer to 100) start first.
2. If priorities are equal, older tasks (earlier creation time) start first.

Priority determines execution **order**, not eligibility — all ready tasks will eventually run.

![Priority Within a Level](images/priority-within-level.png)

### What Happens When a Task Fails

| Downstream Task Condition | Behavior                                |
|---------------------------|-----------------------------------------|
| `run_if: "success"`       | Blocked — will not run                  |
| `run_if: "failure"`       | Triggered — starts executing            |
| No `run_if` (default)     | Blocked — treated as `"success"`        |

The rest of the workflow continues unaffected. Only the specific branch depending on the failed task is impacted.

### How Data Flows Through the DAG

Each task receives a consolidated map of all its parents' results. If a parent produced no results or was skipped, it is omitted from the map.

---

## Execution Modes (Jobs)

When creating a group of tasks as a **job** (via `POST /jobs`), you can choose an execution mode:

| Mode             | Behavior                                                              |
|------------------|-----------------------------------------------------------------------|
| `parallel`       | All tasks with no dependencies start simultaneously                   |
| `sequential`     | Tasks execute one level at a time, waiting for each level to complete |
| `configurable`   | Full DAG-based execution respecting all declared dependencies         |

Use `configurable` mode for workflows that require fine-grained dependency control.

---

## Examples

### ETL Pipeline

Extract data from a source, transform it, then load it into a destination.

![ETL Pipeline](images/etl-pipeline.png)

```json
{
  "tasks": [
    {
      "name": "Extract from API",
      "image_url": "oci://registry.example.com/etl-extract:latest",
      "depends_on": [],
      "priority": 70,
      "env": { "SOURCE_URL": "https://api.example.com/data" }
    },
    {
      "name": "Transform Records",
      "image_url": "oci://registry.example.com/etl-transform:latest",
      "depends_on": ["<extract-task-id>"],
      "run_if": "success",
      "priority": 70
    },
    {
      "name": "Load to Warehouse",
      "image_url": "oci://registry.example.com/etl-load:latest",
      "depends_on": ["<transform-task-id>"],
      "run_if": "success",
      "priority": 70
    }
  ]
}
```

### Image Processing Pipeline with Parallel Steps

Ingest an image, then run multiple processing steps in parallel, and merge results.

![Image Processing Pipeline with Parallel Steps](images/fanout-fanin.png)

```json
{
  "tasks": [
    {
      "name": "Ingest Image",
      "image_url": "oci://registry.example.com/img-ingest:latest",
      "depends_on": []
    },
    {
      "name": "Resize",
      "image_url": "oci://registry.example.com/img-resize:latest",
      "depends_on": ["<ingest-task-id>"],
      "run_if": "success"
    },
    {
      "name": "Watermark",
      "image_url": "oci://registry.example.com/img-watermark:latest",
      "depends_on": ["<ingest-task-id>"],
      "run_if": "success"
    },
    {
      "name": "Compress",
      "image_url": "oci://registry.example.com/img-compress:latest",
      "depends_on": ["<ingest-task-id>"],
      "run_if": "success"
    },
    {
      "name": "Merge and Upload",
      "image_url": "oci://registry.example.com/img-merge:latest",
      "depends_on": ["<resize-task-id>", "<watermark-task-id>", "<compress-task-id>"],
      "run_if": "success"
    }
  ]
}
```

### Billing Workflow with Error Handling

Process a payment, then branch into success or failure paths.

```json
{
  "tasks": [
    {
      "name": "Validate Payment Details",
      "image_url": "oci://registry.example.com/billing-validate:latest",
      "depends_on": [],
      "priority": 90
    },
    {
      "name": "Charge Card",
      "image_url": "oci://registry.example.com/billing-charge:latest",
      "depends_on": ["<validate-task-id>"],
      "run_if": "success",
      "priority": 90
    },
    {
      "name": "Send Receipt",
      "image_url": "oci://registry.example.com/billing-receipt:latest",
      "depends_on": ["<charge-task-id>"],
      "run_if": "success",
      "priority": 80
    },
    {
      "name": "Refund and Alert",
      "image_url": "oci://registry.example.com/billing-refund:latest",
      "depends_on": ["<charge-task-id>"],
      "run_if": "failure",
      "priority": 95
    }
  ]
}
```

## Use Cases

### Data Pipelines

Build ETL or ELT pipelines where data flows through extraction, transformation, validation, and loading stages. Use dependencies to enforce order and data passing to hand off processed records between stages.

### Event-Driven Processing

React to external events by triggering workflows. For example, when new data arrives, kick off a `validation → processing → notification` pipeline where each step depends on the previous.

### Business Process Automation

Model multi-step business processes (order fulfillment, onboarding, claims processing) as workflows. Use conditional execution to handle different outcomes at each step — success paths and failure paths.

### Dependent Background Jobs

Coordinate background jobs that must run in a specific order. For example, generate a report only after all data sources have been refreshed, then email the report only if generation succeeded.

### Conditional Notification Workflows

Send different notifications based on task outcomes. Use `run_if: "success"` for confirmation messages and `run_if: "failure"` for alert notifications, both depending on the same upstream task.

### Parallel Processing with Fan-Out / Fan-In

Split a workload into parallel branches (fan-out), process each independently, and merge results in a final step (fan-in). This pattern significantly reduces total pipeline duration compared to sequential execution.

---

## Best Practices

### Design Acyclic Workflows

Always ensure your dependency graph has no cycles. A cycle means two or more tasks depend on each other (directly or indirectly), making it impossible to determine which should run first. The system validates this and rejects circular dependencies at creation time.

**Valid:**

```bash
A → B → C → D
```

**Invalid (cycle):**

```bash
A → B → C → A   (rejected)
```

### Avoid Circular Dependencies

When designing complex workflows, sketch the dependency graph before defining tasks. Verify that every path through the graph moves in one direction. Common mistakes include:

- A task depending on a downstream task "just to be safe."
- Two tasks that should be independent accidentally depending on each other.
- Chains that inadvertently loop back via an indirect path.

### Keep Tasks Idempotent

Design each task so that running it multiple times with the same input produces the same result. This is important because:

- A task might be retried after a transient failure.
- During development, you may need to re-run a workflow.
- Idempotent tasks are safe to re-execute without side effects like duplicate records or double-charged transactions.

Use techniques like upserts, deduplication keys, and conditional writes.

### Design Safe Data Contracts Between Tasks

When tasks pass data to each other:

- **Document the expected output shape** of each task so downstream consumers know what to expect.
- **Handle missing fields gracefully** — a parent task might not always produce every field.
- **Avoid passing large payloads** through results. Instead, write large data to external storage (e.g., object storage) and pass a reference (URL or path) in the results.
- **Version your data contracts** if multiple teams maintain different tasks in the same workflow.

### Handle Failure Scenarios

- Attach `run_if: "failure"` tasks to critical steps so failures are handled automatically (alerting, cleanup, rollback).
- Do not assume every task will succeed. Design workflows with both success and failure paths where appropriate.
- Monitor task results and error fields for recurring failures.

### Structure Large Workflows

- **Keep workflows focused.** A workflow that does one pipeline well is better than one that tries to do everything.
- **Use meaningful task names** so the workflow is self-documenting.
- **Assign appropriate priorities.** Use higher priorities for time-sensitive steps and lower priorities for background work.
- **Minimize the depth of your DAG.** Flatter graphs (more parallelism) complete faster than deep sequential chains.
- **Stagger scheduled workflows** to avoid overwhelming the system with many simultaneous pipelines.
